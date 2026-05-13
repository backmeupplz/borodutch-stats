// Dependencies
import { createConnection } from 'mongoose'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const Telegraf = require('telegraf')

// ─── Types ──────────────────────────────────────────────────────────────

export interface ChatCacheEntry {
  id: number
  reachable: boolean
  type?: 'private' | 'group' | 'supergroup' | 'channel'
  members?: number
  lastChecked: number
  error?: string
}

export interface ReachabilityOptions {
  concurrency?: number
  batchSize?: number
  cacheTtlMs?: number
  maxRetries?: number
  initialRetryDelayMs?: number
  saveInterval?: number
}

export interface ReachabilityResult {
  totalUsers: number
  directCount: number
  groupCount: number
  supergroupCount: number
  channelCount: number
  unreachableCount: number
  groupAudience: number
  supergroupAudience: number
  channelAudience: number
  totalAudience: number
  checkedCount: number
  cachedCount: number
  totalChats: number
}

interface CacheFile {
  version: number
  lastUpdated: number
  chats: { [id: string]: ChatCacheEntry }
}

// ─── Constants ─────────────────────────────────────────────────────────

const DEFAULT_CONCURRENCY = 30
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_RETRIES = 5
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1000
const DEFAULT_SAVE_INTERVAL = 5

const CACHE_VERSION = 1

// ─── Utilities ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(function (res) {
    setTimeout(function () {
      res()
    }, ms)
  })
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function getCacheDir(): string {
  return join(__dirname, '..', '..', 'cache')
}

function getCachePath(name: string): string {
  return join(getCacheDir(), sanitizeName(name) + '.json')
}

// ─── Cache ─────────────────────────────────────────────────────────────

function loadCache(name: string): CacheFile {
  const path = getCachePath(name)
  try {
    const raw = readFileSync(path, 'utf8')
    const data = JSON.parse(raw) as CacheFile
    if (data.version !== CACHE_VERSION) {
      console.log(`Cache version mismatch for ${name}, resetting`)
      return { version: CACHE_VERSION, lastUpdated: 0, chats: {} }
    }
    return data
  } catch (err) {
    return { version: CACHE_VERSION, lastUpdated: 0, chats: {} }
  }
}

function saveCache(name: string, cache: CacheFile): void {
  const dir = getCacheDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  cache.lastUpdated = Date.now()
  writeFileSync(getCachePath(name), JSON.stringify(cache, null, 2))
}

// ─── Concurrency limiter ────────────────────────────────────────────────

export function createLimiter(limit: number) {
  let running = 0
  const queue: Array<() => void> = []

  function acquire(): Promise<void> {
    if (running < limit) {
      running++
      return Promise.resolve()
    }
    return new Promise(function (res) {
      queue.push(res)
    })
  }

  function release(): void {
    running--
    const next = queue.shift()
    if (next) {
      running++
      next()
    }
  }

  return { acquire: acquire, release: release }
}

// ─── Retry wrapper ──────────────────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  initialDelayMs: number
): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err) {
      let waitMs = 0
      // Detect Telegram rate-limit (429 with retry_after)
      if (
        err &&
        err.response &&
        err.response.parameters &&
        err.response.parameters.retry_after
      ) {
        waitMs = err.response.parameters.retry_after * 1000
      }
      if (waitMs > 0) {
        console.log('Rate limited, waiting ' + waitMs + 'ms')
        await sleep(waitMs)
        // Rate-limit waits don't consume the retry budget
      } else if (attempt < maxRetries) {
        const backoff = initialDelayMs * Math.pow(2, attempt)
        console.log(
          'Attempt ' + (attempt + 1) + '/' + maxRetries + ' failed, retrying after ' + backoff + 'ms'
        )
        await sleep(backoff)
        attempt++
      } else {
        throw err
      }
    }
  }
}

// ─── Reachability check ────────────────────────────────────────────────

async function checkChatReachability(
  bot: any,
  id: number
): Promise<{ reachable: boolean; type?: string; error?: string }> {
  try {
    const chat: any = await withRetry(
      function () {
        return bot.telegram.getChat(id)
      },
      3,
      500
    )
    return { reachable: true, type: chat.type }
  } catch (err) {
    return {
      reachable: false,
      error: err.message || String(err),
    }
  }
}

// ─── Audience check ────────────────────────────────────────────────────

async function getChatAudience(bot: any, id: number): Promise<number> {
  try {
    return await withRetry(
      function () {
        return bot.telegram.getChatMembersCount(id)
      },
      3,
      500
    )
  } catch (err) {
    return 0
  }
}

// ─── Result aggregation ───────────────────────────────────────────────

export function updateResultFromEntry(
  result: ReachabilityResult,
  entry: ChatCacheEntry
): void {
  if (!entry.reachable) {
    result.unreachableCount++
    return
  }
  switch (entry.type) {
    case 'private':
      result.directCount++
      break
    case 'group':
      result.groupCount++
      result.groupAudience += entry.members || 0
      break
    case 'supergroup':
      result.supergroupCount++
      result.supergroupAudience += entry.members || 0
      break
    case 'channel':
      result.channelCount++
      result.channelAudience += entry.members || 0
      break
    default:
      // Unknown type — treat as direct
      result.directCount++
      break
  }
}

// ─── Main reachability function ────────────────────────────────────────

export async function getBotReachability(
  name: string,
  mongo: string,
  telegramToken: string,
  idFieldName: string = 'id',
  chatCollectionName: string = 'chats',
  options: ReachabilityOptions = {}
): Promise<ReachabilityResult> {
  const concurrency =
    options.concurrency !== undefined
      ? options.concurrency
      : DEFAULT_CONCURRENCY
  const batchSize =
    options.batchSize !== undefined ? options.batchSize : DEFAULT_BATCH_SIZE
  const cacheTtlMs =
    options.cacheTtlMs !== undefined
      ? options.cacheTtlMs
      : DEFAULT_CACHE_TTL_MS
  const maxRetries =
    options.maxRetries !== undefined
      ? options.maxRetries
      : DEFAULT_MAX_RETRIES
  const initialRetryDelayMs =
    options.initialRetryDelayMs !== undefined
      ? options.initialRetryDelayMs
      : DEFAULT_INITIAL_RETRY_DELAY_MS
  const saveInterval =
    options.saveInterval !== undefined
      ? options.saveInterval
      : DEFAULT_SAVE_INTERVAL

  console.log(
    '+ getting reachability for ' +
      name +
      ' (concurrency=' +
      concurrency +
      ', batch=' +
      batchSize +
      ')'
  )

  const connection = await createConnection(mongo, {
    useNewUrlParser: true,
  })
  const Chat = connection.collection(chatCollectionName)
  const chatCount = await Chat.find().count()
  console.log('+ got ' + chatCount + ' chats for ' + name + ', loading cache...')

  const cache = loadCache(name)
  const now = Date.now()
  const staleThreshold = now - cacheTtlMs

  // Fetch all chat ids
  const projection: any = { _id: 0 }
  projection[idFieldName] = 1
  const chats = await Chat.find({}, { projection: projection }).toArray()
  console.log('+ got ' + chats.length + ' chat objects for ' + name)

  await connection.close()

  const bot = new Telegraf(telegramToken, {
    channelMode: true,
  })
  const limiter = createLimiter(concurrency)

  const result: ReachabilityResult = {
    totalUsers: 0,
    directCount: 0,
    groupCount: 0,
    supergroupCount: 0,
    channelCount: 0,
    unreachableCount: 0,
    groupAudience: 0,
    supergroupAudience: 0,
    channelAudience: 0,
    totalAudience: 0,
    checkedCount: 0,
    cachedCount: 0,
    totalChats: chats.length,
  }

  let batchIndex = 0

  for (let i = 0; i < chats.length; i += batchSize) {
    const batch = chats.slice(i, i + batchSize)
    console.log(
      '+ ' + name + ' batch ' + i + '/' + chats.length
    )

    const promises = batch.map(function (chat: any) {
      return new Promise<void>(async function (res) {
        const id = parseInt(chat[idFieldName], 10)
        const cached = cache.chats[String(id)]

        // Use cache if fresh
        if (cached && cached.lastChecked > staleThreshold) {
          result.cachedCount++
          updateResultFromEntry(result, cached)
          res()
          return
        }

        await limiter.acquire()
        try {
          const reachability = await checkChatReachability(bot, id)
          const entry: ChatCacheEntry = {
            id: id,
            reachable: reachability.reachable,
            type: reachability.type as any,
            lastChecked: now,
            error: reachability.error,
          }

          if (reachability.reachable && id < 0) {
            // Group / supergroup / channel — get audience size
            entry.members = await getChatAudience(bot, id)
          } else if (id > 0) {
            // Private chat
            entry.members = 1
          }

          cache.chats[String(id)] = entry
          result.checkedCount++
          updateResultFromEntry(result, entry)
        } catch (err) {
          // Should be rare (withRetry throws only after exhausting retries)
          console.log('Fatal error checking chat ' + id + ': ' + (err.message || String(err)))
          const entry: ChatCacheEntry = {
            id: id,
            reachable: false,
            lastChecked: now,
            error: err.message || String(err),
          }
          cache.chats[String(id)] = entry
          result.checkedCount++
          updateResultFromEntry(result, entry)
        } finally {
          limiter.release()
        }
        res()
      })
    })

    await Promise.all(promises)

    batchIndex++

    // Save cache every N batches for resumability
    if (
      batchIndex % saveInterval === 0 ||
      i + batchSize >= chats.length
    ) {
      saveCache(name, cache)
      console.log('+ ' + name + ' cache saved (' + Object.keys(cache.chats).length + ' entries)')
    }

    // Small breathing room between batches
    if (i + batchSize < chats.length) {
      await sleep(100)
    }
  }

  // Final save
  saveCache(name, cache)

  // Legacy total: private (1 each) + group member counts
  result.totalUsers =
    result.directCount +
    result.groupAudience +
    result.supergroupAudience +
    result.channelAudience
  result.totalAudience = result.totalUsers

  console.log(
    '+ ' +
      name +
      ' reachability: direct=' +
      result.directCount +
      ', groups=' +
      result.groupCount +
      '(' +
      result.groupAudience +
      ')' +
      ', supergroups=' +
      result.supergroupCount +
      '(' +
      result.supergroupAudience +
      ')' +
      ', channels=' +
      result.channelCount +
      '(' +
      result.channelAudience +
      ')' +
      ', unreachable=' +
      result.unreachableCount
  )

  return result
}

// ─── Legacy wrapper (preserves old API) ───────────────────────────────

export async function getBotUsers(
  name: string,
  mongo: string,
  telegramToken: string,
  idFieldName: string = 'id',
  chatCollectionName: string = 'chats'
): Promise<number> {
  const reachability = await getBotReachability(
    name,
    mongo,
    telegramToken,
    idFieldName,
    chatCollectionName
  )
  return reachability.totalUsers
}

// ─── Speller reachability variant ──────────────────────────────────────

export async function getBotReachabilityForSpeller(
  name: string,
  mongo: string,
  telegramToken: string,
  options: ReachabilityOptions = {}
): Promise<ReachabilityResult> {
  const concurrency =
    options.concurrency !== undefined
      ? options.concurrency
      : DEFAULT_CONCURRENCY
  const batchSize =
    options.batchSize !== undefined ? options.batchSize : DEFAULT_BATCH_SIZE
  const cacheTtlMs =
    options.cacheTtlMs !== undefined
      ? options.cacheTtlMs
      : DEFAULT_CACHE_TTL_MS
  const maxRetries =
    options.maxRetries !== undefined
      ? options.maxRetries
      : DEFAULT_MAX_RETRIES
  const initialRetryDelayMs =
    options.initialRetryDelayMs !== undefined
      ? options.initialRetryDelayMs
      : DEFAULT_INITIAL_RETRY_DELAY_MS
  const saveInterval =
    options.saveInterval !== undefined
      ? options.saveInterval
      : DEFAULT_SAVE_INTERVAL

  console.log('+ getting reachability for ' + name + ' (speller variant)')

  const connection = await createConnection(mongo, {
    useNewUrlParser: true,
  })
  const User = connection.collection('users')
  const userCount = await User.find().count()
  const users = await User.find().toArray()
  const channels: number[] = users.reduce(function (
    p: number[],
    c: any
  ) {
    return p.concat(c.channels || [])
  }, [])
  console.log(
    '+ got ' + userCount + ' users, ' + channels.length + ' channels for ' + name
  )

  await connection.close()

  const cache = loadCache(name)
  const now = Date.now()
  const staleThreshold = now - cacheTtlMs

  const bot = new Telegraf(telegramToken, {
    channelMode: true,
  })
  const limiter = createLimiter(concurrency)

  const result: ReachabilityResult = {
    totalUsers: 0,
    directCount: userCount,
    groupCount: 0,
    supergroupCount: 0,
    channelCount: 0,
    unreachableCount: 0,
    groupAudience: 0,
    supergroupAudience: 0,
    channelAudience: 0,
    totalAudience: 0,
    checkedCount: 0,
    cachedCount: 0,
    totalChats: userCount + channels.length,
  }

  let batchIndex = 0

  for (let i = 0; i < channels.length; i += batchSize) {
    const batch = channels.slice(i, i + batchSize)
    console.log(
      '+ ' + name + ' channels batch ' + i + '/' + channels.length
    )

    const promises = batch.map(function (channelId: number) {
      return new Promise<void>(async function (res) {
        const id = parseInt(channelId as any, 10)
        const cached = cache.chats[String(id)]

        if (cached && cached.lastChecked > staleThreshold) {
          result.cachedCount++
          updateResultFromEntry(result, cached)
          res()
          return
        }

        await limiter.acquire()
        try {
          const reachability = await checkChatReachability(bot, id)
          const entry: ChatCacheEntry = {
            id: id,
            reachable: reachability.reachable,
            type: reachability.type as any,
            lastChecked: now,
            error: reachability.error,
          }

          if (reachability.reachable) {
            entry.members = await getChatAudience(bot, id)
          }

          cache.chats[String(id)] = entry
          result.checkedCount++
          updateResultFromEntry(result, entry)
        } catch (err) {
          console.log(
            'Fatal error checking channel ' + id + ': ' + (err.message || String(err))
          )
          const entry: ChatCacheEntry = {
            id: id,
            reachable: false,
            lastChecked: now,
            error: err.message || String(err),
          }
          cache.chats[String(id)] = entry
          result.checkedCount++
          updateResultFromEntry(result, entry)
        } finally {
          limiter.release()
        }
        res()
      })
    })

    await Promise.all(promises)

    batchIndex++
    if (
      batchIndex % saveInterval === 0 ||
      i + batchSize >= channels.length
    ) {
      saveCache(name, cache)
      console.log(
        '+ ' + name + ' cache saved (' + Object.keys(cache.chats).length + ' entries)'
      )
    }

    if (i + batchSize < channels.length) {
      await sleep(100)
    }
  }

  saveCache(name, cache)

  // Legacy total: users + channel member counts
  result.totalUsers =
    userCount +
    result.groupAudience +
    result.supergroupAudience +
    result.channelAudience
  result.totalAudience = result.totalUsers

  console.log(
    '+ ' +
      name +
      ' reachability: users=' +
      userCount +
      ', groups=' +
      result.groupCount +
      '(' +
      result.groupAudience +
      ')' +
      ', supergroups=' +
      result.supergroupCount +
      '(' +
      result.supergroupAudience +
      ')' +
      ', channels=' +
      result.channelCount +
      '(' +
      result.channelAudience +
      ')' +
      ', unreachable=' +
      result.unreachableCount
  )

  return result
}

// ─── Speller legacy wrapper ────────────────────────────────────────────

export async function getBotUsersForSpeller(
  name: string,
  mongo: string,
  telegramToken: string
): Promise<number> {
  const reachability = await getBotReachabilityForSpeller(
    name,
    mongo,
    telegramToken
  )
  return reachability.totalUsers
}
