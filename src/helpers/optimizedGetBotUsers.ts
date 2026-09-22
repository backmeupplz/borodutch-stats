/**
 * Resumable bot reach collection.
 *
 * Private chat IDs are counted locally, matching the historical counter. Only
 * groups/channels require Telegram API calls. Additional collections can supply
 * chat IDs which survived a primary chats-collection wipe.
 */

import { createConnection } from 'mongoose'
import { ReachabilityMetrics } from './reachability'
import { TelegramPool, PoolOptions } from './telegramPool'
import { Checkpoint } from './checkpoint'

const Telegraf = require('telegraf')

export interface ChatIdSource {
  collectionName: string
  fieldNames: string[]
}

export interface ChatIdSourceInventory {
  collectionName: string
  fieldNames: string[]
  rawValues: number
  invalidValues: number
  duplicateValues: number
  addedPrivateIds: number
  addedGroupIds: number
}

export interface BotUsersMetrics {
  legacyUserCount: number
  reachability: ReachabilityMetrics
  inventory: {
    privateIds: number
    groupIds: number
    checkpointedGroups: number
    sources: ChatIdSourceInventory[]
  }
}

interface OptimizedOptions extends PoolOptions {
  chunkSize?: number
  additionalChatSources?: ChatIdSource[]
  refreshAll?: boolean
}

const DEFAULT_OPTIONS: OptimizedOptions = {
  concurrency: 20,
  // Two Bot API calls per group, kept within Telegram's bot-wide limit.
  ratePerSecond: 15,
  maxRetries: 5,
  baseDelayMs: 1000,
  chunkSize: 500,
  additionalChatSources: [],
  refreshAll: false,
}

function parseChatId(value: any): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value !== 0 ? value : undefined
  }
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed !== 0 ? parsed : undefined
}

function valuesForField(document: any, fieldName: string): any[] {
  const value = document[fieldName]
  return Array.isArray(value) ? value : [value]
}

async function collectChatIds(
  connection: any,
  sources: ChatIdSource[]
): Promise<{
  privateIds: Set<number>
  groupIds: Set<number>
  inventory: ChatIdSourceInventory[]
}> {
  const privateIds = new Set<number>()
  const groupIds = new Set<number>()
  const inventory: ChatIdSourceInventory[] = []

  for (const source of sources) {
    const stats: ChatIdSourceInventory = {
      collectionName: source.collectionName,
      fieldNames: source.fieldNames,
      rawValues: 0,
      invalidValues: 0,
      duplicateValues: 0,
      addedPrivateIds: 0,
      addedGroupIds: 0,
    }
    const projection: any = { _id: 0 }
    for (const fieldName of source.fieldNames) {
      projection[fieldName] = 1
    }
    const cursor = connection
      .collection(source.collectionName)
      .find({}, { projection: projection })

    while (await cursor.hasNext()) {
      const document = await cursor.next()
      for (const fieldName of source.fieldNames) {
        for (const rawValue of valuesForField(document || {}, fieldName)) {
          stats.rawValues++
          const id = parseChatId(rawValue)
          if (id === undefined) {
            stats.invalidValues++
            continue
          }
          const ids = id > 0 ? privateIds : groupIds
          if (ids.has(id)) {
            stats.duplicateValues++
            continue
          }
          ids.add(id)
          if (id > 0) {
            stats.addedPrivateIds++
          } else {
            stats.addedGroupIds++
          }
        }
      }
    }
    inventory.push(stats)
  }

  return { privateIds: privateIds, groupIds: groupIds, inventory: inventory }
}

async function processGroups(
  name: string,
  telegramToken: string,
  groupIds: Set<number>,
  options: OptimizedOptions
): Promise<{
  metrics: ReachabilityMetrics
  legacyCount: number
  checkpointedGroups: number
}> {
  const checkpoint = new Checkpoint(name)
  await checkpoint.load()
  const aggregateGroupIds = new Set(groupIds)
  for (const id of groupIds) {
    const saved = checkpoint.getResult(id)
    if (saved && saved.canonicalChatId !== undefined) {
      aggregateGroupIds.delete(id)
      aggregateGroupIds.add(saved.canonicalChatId)
    }
  }
  const pending = options.refreshAll
    ? Array.from(groupIds)
    : Array.from(groupIds).filter(function (id) {
        return !checkpoint.isProcessed(id)
      })
  const pool = new TelegramPool(options)
  const bot = new Telegraf(telegramToken, { channelMode: true })
  const botInfo = await bot.telegram.getMe()
  const chunkSize = options.chunkSize || 500
  let failures = 0

  console.log(
    '+ ' + name + ': ' + pending.length + ' groups to check' +
      (checkpoint.size() > 0
        ? ' (' + checkpoint.size() + ' checkpointed)'
        : '')
  )

  for (let i = 0; i < pending.length; i += chunkSize) {
    const chunk = pending.slice(i, i + chunkSize)
    await Promise.all(
      chunk.map(function (id) {
        return pool
          .execute(function () {
            return checkChatReachability(bot, botInfo.id, id)
          })
          .then(function (result) {
            if (result.canonicalChatId && result.canonicalChatId !== id) {
              aggregateGroupIds.delete(id)
              aggregateGroupIds.add(result.canonicalChatId)
              checkpoint.appendResult({
                chatId: id,
                canonicalChatId: result.canonicalChatId,
                reachable: false,
                kind: 'unknown',
                checkedAt: Date.now(),
              })
              if (groupIds.has(result.canonicalChatId)) {
                return
              }
              checkpoint.appendResult({
                chatId: result.canonicalChatId,
                reachable: result.reachable,
                kind: result.kind as any,
                memberCount: result.memberCount,
                checkedAt: Date.now(),
              })
              return
            }
            checkpoint.appendResult({
              chatId: id,
              reachable: result.reachable,
              kind: result.kind as any,
              memberCount: result.memberCount,
              memberCountUnavailable: result.memberCountUnavailable,
              checkedAt: Date.now(),
            })
          })
          .catch(function () {
            failures++
          })
      })
    )

    if ((i + chunkSize) % 5000 === 0 || i + chunkSize >= pending.length) {
      console.log(
        '+ ' + name + ': processed ' +
          Math.min(i + chunkSize, pending.length) + '/' + pending.length
      )
    }
  }

  await pool.drain()
  pool.destroy()
  await checkpoint.close()

  if (failures > 0) {
    throw new Error(
      name + ' had ' + failures +
        ' Telegram failures; checkpoint preserved for retry'
    )
  }

  return {
    metrics: checkpoint.getMetrics(aggregateGroupIds),
    legacyCount: checkpoint.getLegacyCount(aggregateGroupIds),
    checkpointedGroups: groupIds.size,
  }
}

export async function getBotUsersFromChatIdsOptimized(
  name: string,
  telegramToken: string,
  privateIds: Set<number>,
  groupIds: Set<number>,
  options: Partial<OptimizedOptions> = {}
): Promise<BotUsersMetrics> {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options)
  const groups = await processGroups(name, telegramToken, groupIds, opts)
  const reachability: ReachabilityMetrics = {
    reachableChatCount:
      privateIds.size + groups.metrics.reachableChatCount,
    reachablePrivateChatCount: privateIds.size,
    reachableGroupChatCount: groups.metrics.reachableGroupChatCount,
    reachableChannelCount: groups.metrics.reachableChannelCount,
    totalGroupAudienceEstimate: groups.metrics.totalGroupAudienceEstimate,
    unavailableGroupMemberCount:
      groups.metrics.unavailableGroupMemberCount,
    unreachableChatCount: groups.metrics.unreachableChatCount,
  }
  return {
    legacyUserCount: privateIds.size + groups.legacyCount,
    reachability: reachability,
    inventory: {
      privateIds: privateIds.size,
      groupIds: groupIds.size,
      checkpointedGroups: groups.checkpointedGroups,
      sources: [],
    },
  }
}

export async function getBotUsersOptimized(
  name: string,
  mongo: string,
  telegramToken: string,
  idFieldName: string = 'id',
  chatCollectionName: string = 'chats',
  options: Partial<OptimizedOptions> = {}
): Promise<BotUsersMetrics> {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options)
  const connection = await (createConnection(mongo, {
    useNewUrlParser: true,
  } as any) as any).asPromise()
  const sources: ChatIdSource[] = [
    { collectionName: chatCollectionName, fieldNames: [idFieldName] },
  ].concat(opts.additionalChatSources || [])

  try {
    const ids = await collectChatIds(connection, sources)
    const result = await getBotUsersFromChatIdsOptimized(
      name,
      telegramToken,
      ids.privateIds,
      ids.groupIds,
      opts
    )
    result.inventory.sources = ids.inventory
    return result
  } finally {
    await connection.close()
  }
}

export async function getBotUsersForSpellerOptimized(
  name: string,
  mongo: string,
  telegramToken: string,
  options: Partial<OptimizedOptions> = {}
): Promise<BotUsersMetrics> {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options)
  const connection = await (createConnection(mongo, {
    useNewUrlParser: true,
  } as any) as any).asPromise()

  try {
    const User = connection.collection('users')
    const userCount = await User.find().count()
    const ids = new Set<number>()
    const cursor = User.find({}, { projection: { channels: 1, _id: 0 } })
    while (await cursor.hasNext()) {
      const document = await cursor.next()
      for (const rawValue of (document && document.channels) || []) {
        const id = parseChatId(rawValue)
        if (id !== undefined && id < 0) {
          ids.add(id)
        }
      }
    }

    const groups = await processGroups(name, telegramToken, ids, opts)
    const reachability: ReachabilityMetrics = {
      reachableChatCount: userCount + groups.metrics.reachableChatCount,
      reachablePrivateChatCount: userCount,
      reachableGroupChatCount: groups.metrics.reachableGroupChatCount,
      reachableChannelCount: groups.metrics.reachableChannelCount,
      totalGroupAudienceEstimate: groups.metrics.totalGroupAudienceEstimate,
      unavailableGroupMemberCount:
        groups.metrics.unavailableGroupMemberCount,
      unreachableChatCount: groups.metrics.unreachableChatCount,
    }
    return {
      legacyUserCount: userCount + groups.legacyCount,
      reachability: reachability,
      inventory: {
        privateIds: userCount,
        groupIds: ids.size,
        checkpointedGroups: groups.checkpointedGroups,
        sources: [
          {
            collectionName: 'users',
            fieldNames: ['channels'],
            rawValues: ids.size,
            invalidValues: 0,
            duplicateValues: 0,
            addedPrivateIds: userCount,
            addedGroupIds: ids.size,
          },
        ],
      },
    }
  } finally {
    await connection.close()
  }
}

async function checkChatReachability(
  bot: any,
  botId: number,
  chatId: number
): Promise<{
  reachable: boolean
  kind: string
  memberCount?: number
  memberCountUnavailable?: boolean
  canonicalChatId?: number
}> {
  let member: any
  try {
    member = await bot.telegram.getChatMember(chatId, botId)
  } catch (err) {
    if (isRetryableError(err)) {
      throw err
    }
    const migratedId = migratedChatId(err)
    if (migratedId !== undefined) {
      const migrated = await checkChatReachability(bot, botId, migratedId)
      migrated.canonicalChatId = migratedId
      return migrated
    }
    return { reachable: false, kind: 'unknown' }
  }

  if (member.status === 'left' || member.status === 'kicked') {
    return { reachable: false, kind: 'unknown' }
  }

  try {
    const count = await bot.telegram.getChatMembersCount(chatId)
    return { reachable: true, kind: 'unknown', memberCount: count }
  } catch (err) {
    if (isRetryableError(err)) {
      throw err
    }
    throw new Error('Telegram member count unavailable for ' + chatId)
  }
}

function migratedChatId(err: any): number | undefined {
  const value =
    err && err.response && err.response.parameters
      ? err.response.parameters.migrate_to_chat_id
      : undefined
  return parseChatId(value)
}

export function isRetryableError(err: any): boolean {
  const errorCode = err && err.response && err.response.error_code
  return (
    errorCode === 429 ||
    (errorCode >= 500 && errorCode < 600) ||
    (err && err.code === 'ETIMEDOUT') ||
    (err && err.code === 'ECONNRESET') ||
    (err && err.code === 'ECONNREFUSED') ||
    (err && err.code === 'ENOTFOUND') ||
    false
  )
}
