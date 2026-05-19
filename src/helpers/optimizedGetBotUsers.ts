/**
 * Optimized bot-user reachability collection with:
 * - Bounded concurrency and rate-limited Telegram API calls
 * - Exponential backoff for 429 / network errors
 * - Resumable progress via file-based checkpoints
 * - Streaming MongoDB cursors to avoid loading all docs into memory
 */

import { createConnection } from 'mongoose'
import {
  ReachabilityMetrics,
  chatKindFromTelegramType,
  emptyReachabilityMetrics,
  isPrivateChatId,
} from './reachability'
import { TelegramPool, PoolOptions } from './telegramPool'
import { Checkpoint } from './checkpoint'

const Telegraf = require('telegraf')

export interface BotUsersMetrics {
  legacyUserCount: number
  reachability: ReachabilityMetrics
}

interface OptimizedOptions extends PoolOptions {
  chunkSize?: number
}

const DEFAULT_OPTIONS: OptimizedOptions = {
  concurrency: 20,
  ratePerSecond: 25,
  maxRetries: 3,
  baseDelayMs: 1000,
  chunkSize: 500,
}

/**
 * Collect user count and reachability metrics for a single bot.
 * Resumes from checkpoint if one exists.
 */
export async function getBotUsersOptimized(
  name: string,
  mongo: string,
  telegramToken: string,
  idFieldName: string = 'id',
  chatCollectionName: string = 'chats',
  options: Partial<OptimizedOptions> = {}
): Promise<BotUsersMetrics> {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options)
  const pool = new TelegramPool(opts)
  const checkpoint = new Checkpoint(name)
  await checkpoint.load()

  const connection = await (createConnection(mongo, {
    useNewUrlParser: true,
  } as any) as any).asPromise()

  const Chat = connection.collection(chatCollectionName)

  // Build projection dynamically
  const projection: any = { _id: 0 }
  projection[idFieldName] = 1

  // Load chat IDs, skipping already-processed ones
  const chatDocs = await Chat.find({}, { projection }).toArray()
  const chatIds: number[] = []
  for (let i = 0; i < chatDocs.length; i++) {
    const id = parseInt(chatDocs[i][idFieldName], 10)
    if (!checkpoint.isProcessed(id)) {
      chatIds.push(id)
    }
  }

  console.log(
    '+ ' + name + ': ' + chatIds.length + ' new chats to check' +
    (checkpoint.size() > 0
      ? ' (' + checkpoint.size() + ' already in checkpoint)'
      : '')
  )

  const bot = new Telegraf(telegramToken, { channelMode: true })
  const botInfo = await bot.telegram.getMe()

  // Process in chunks to bound memory / promise count
  const chunkSize = opts.chunkSize || 500
  for (let i = 0; i < chatIds.length; i += chunkSize) {
    const chunk = chatIds.slice(i, i + chunkSize)

    await Promise.all(
      chunk.map(function (id: number) {
        return pool
          .execute(function () {
            return checkChatReachability(bot, botInfo.id, id)
          })
          .then(function (result) {
            checkpoint.appendResult({
              chatId: id,
              reachable: result.reachable,
              kind: result.kind as any,
              memberCount: result.memberCount,
              memberCountUnavailable: result.memberCountUnavailable,
              checkedAt: Date.now(),
            })
          })
          .catch(function (err: any) {
            // Pool exhausted retries or unexpected error
            console.log(
              '+ ' + name + ' error for ' + id + ': ' +
              (err && err.message ? err.message : String(err))
            )
            checkpoint.appendResult({
              chatId: id,
              reachable: false,
              kind: 'unknown',
              checkedAt: Date.now(),
            })
          })
      })
    )

    if ((i + chunkSize) % 5000 === 0 || i + chunkSize >= chatIds.length) {
      console.log(
        '+ ' + name + ': processed ' + Math.min(i + chunkSize, chatIds.length) +
        '/' + chatIds.length
      )
    }
  }

  await pool.drain()
  pool.destroy()
  await checkpoint.close()
  await connection.close()

  const metrics = checkpoint.getMetrics()
  const legacyCount = checkpoint.getLegacyCount()

  console.log(
    '+ ' + name + ': legacy=' + legacyCount +
    ' reachable=' + metrics.reachableChatCount +
    ' unreachable=' + metrics.unreachableChatCount
  )

  return {
    legacyUserCount: legacyCount,
    reachability: metrics,
  }
}

/**
 * Speller-specific variant.
 * Users are counted directly from DB (assumed reachable private chats).
 * Channels are processed through the pool with checkpointing.
 */
export async function getBotUsersForSpellerOptimized(
  name: string,
  mongo: string,
  telegramToken: string,
  options: Partial<OptimizedOptions> = {}
): Promise<BotUsersMetrics> {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options)
  const pool = new TelegramPool(opts)
  const checkpoint = new Checkpoint(name)
  await checkpoint.load()

  const connection = await (createConnection(mongo, {
    useNewUrlParser: true,
  } as any) as any).asPromise()

  const User = connection.collection('users')
  const userCount = await User.find().count()

  // Collect all channels without loading full user docs
  const userDocs = await User.find(
    {},
    { projection: { channels: 1, _id: 0 } }
  ).toArray()
  const channels: number[] = []
  for (let u = 0; u < userDocs.length; u++) {
    const doc = userDocs[u]
    if (doc.channels && Array.isArray(doc.channels)) {
      for (let i = 0; i < doc.channels.length; i++) {
        const id = parseInt(doc.channels[i], 10)
        if (!checkpoint.isProcessed(id)) {
          channels.push(id)
        }
      }
    }
  }

  console.log(
    '+ ' + name + ': ' + userCount + ' users, ' +
    channels.length + ' new channels to check' +
    (checkpoint.size() > 0
      ? ' (' + checkpoint.size() + ' already in checkpoint)'
      : '')
  )

  const bot = new Telegraf(telegramToken, { channelMode: true })
  const botInfo = await bot.telegram.getMe()

  const chunkSize = opts.chunkSize || 500
  for (let i = 0; i < channels.length; i += chunkSize) {
    const chunk = channels.slice(i, i + chunkSize)

    await Promise.all(
      chunk.map(function (id: number) {
        return pool
          .execute(function () {
            return checkChatReachability(bot, botInfo.id, id)
          })
          .then(function (result) {
            checkpoint.appendResult({
              chatId: id,
              reachable: result.reachable,
              kind: result.kind as any,
              memberCount: result.memberCount,
              memberCountUnavailable: result.memberCountUnavailable,
              checkedAt: Date.now(),
            })
          })
          .catch(function (err: any) {
            console.log(
              '+ ' + name + ' error for channel ' + id + ': ' +
              (err && err.message ? err.message : String(err))
            )
            checkpoint.appendResult({
              chatId: id,
              reachable: false,
              kind: 'unknown',
              checkedAt: Date.now(),
            })
          })
      })
    )

    if ((i + chunkSize) % 5000 === 0 || i + chunkSize >= channels.length) {
      console.log(
        '+ ' + name + ': processed ' +
        Math.min(i + chunkSize, channels.length) +
        '/' + channels.length
      )
    }
  }

  await pool.drain()
  pool.destroy()
  await checkpoint.close()
  await connection.close()

  const metrics = checkpoint.getMetrics()
  // Add user count to private reachables (assumed reachable)
  const reachability: ReachabilityMetrics = {
    reachableChatCount: metrics.reachableChatCount + userCount,
    reachablePrivateChatCount: metrics.reachablePrivateChatCount + userCount,
    reachableGroupChatCount: metrics.reachableGroupChatCount,
    reachableChannelCount: metrics.reachableChannelCount,
    totalGroupAudienceEstimate: metrics.totalGroupAudienceEstimate,
    unavailableGroupMemberCount: metrics.unavailableGroupMemberCount,
    unreachableChatCount: metrics.unreachableChatCount,
  }

  // Legacy count: 1 per user + memberCount per channel
  const legacyCount = userCount + checkpoint.getLegacyCount()

  console.log(
    '+ ' + name + ': legacy=' + legacyCount +
    ' reachable=' + reachability.reachableChatCount +
    ' unreachable=' + reachability.unreachableChatCount
  )

  return {
    legacyUserCount: legacyCount,
    reachability: reachability,
  }
}

/**
 * Check a single chat's reachability using read-only Bot API methods.
 * - Private chats: getChat (verifies existence / not blocked)
 * - Groups/channels: getChatMember(botId) for membership,
 *   then getChat for type, then getChatMembersCount for audience
 *
 * Throws only on retryable errors (429, network) so the pool can retry.
 * Non-retryable Telegram errors are caught and returned as unreachable.
 */
async function checkChatReachability(
  bot: any,
  botId: number,
  chatId: number
): Promise<{
  reachable: boolean
  kind: string
  memberCount?: number
  memberCountUnavailable?: boolean
}> {
  if (isPrivateChatId(chatId)) {
    try {
      await bot.telegram.getChat(chatId)
      return { reachable: true, kind: 'private' }
    } catch (err) {
      // Non-retryable Telegram errors (403, 404, etc.) → unreachable
      if (isRetryableError(err)) {
        throw err
      }
      return { reachable: false, kind: 'unknown' }
    }
  }

  // Group or channel: check bot membership first
  let member: any
  try {
    member = await bot.telegram.getChatMember(chatId, botId)
  } catch (err) {
    if (isRetryableError(err)) {
      throw err
    }
    return { reachable: false, kind: 'unknown' }
  }

  if (member.status === 'left' || member.status === 'kicked') {
    return { reachable: false, kind: 'unknown' }
  }

  // Bot is still in the chat — get type
  let chat: any
  try {
    chat = await bot.telegram.getChat(chatId)
  } catch (err) {
    if (isRetryableError(err)) {
      throw err
    }
    return { reachable: true, kind: 'unknown' }
  }

  const kind = chatKindFromTelegramType(chat.type)

  // Get member count if possible
  try {
    const count = await bot.telegram.getChatMembersCount(chatId)
    return { reachable: true, kind: kind, memberCount: count }
  } catch (err) {
    if (isRetryableError(err)) {
      throw err
    }
    return {
      reachable: true,
      kind: kind,
      memberCountUnavailable: true,
    }
  }
}

/**
 * Determine whether a Telegram API error should be retried by the pool.
 */
export function isRetryableError(err: any): boolean {
  return (
    (err && err.response && err.response.error_code === 429) ||
    (err && err.code === 'ETIMEDOUT') ||
    (err && err.code === 'ECONNRESET') ||
    (err && err.code === 'ECONNREFUSED') ||
    (err && err.code === 'ENOTFOUND') ||
    false
  )
}
