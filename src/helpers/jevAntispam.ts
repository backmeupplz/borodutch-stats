import { Pool } from 'pg'
import {
  BotUsersMetrics,
  getBotUsersFromChatIdsOptimized,
} from './optimizedGetBotUsers'

interface KnownChatRow {
  chatId: string
  successfulDeletions: string
  processedMessages: string
}

export interface JevAntispamHistoryPoint {
  date: string
  knownChatCount: number
  processedMessageCount: number
  successfulDeletionCount: number
}

export interface JevAntispamStats {
  knownChatCount: number
  privateChatCount: number
  reachableCommunityCount: number
  combinedCommunityAudience: number
  successfulDeletionCount: number
  processedMessageCount?: number
  history?: JevAntispamHistoryPoint[]
}

export interface JevAntispamCollection {
  stats: JevAntispamStats
  bot: BotUsersMetrics
}

function safeInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(name + ' must be a safe integer')
  }
  return parsed
}

export function aggregateKnownChats(rows: KnownChatRow[]) {
  const privateIds = new Set<number>()
  const communityIds = new Set<number>()
  let successfulDeletionCount = 0
  let processedMessageCount = 0

  for (const row of rows) {
    const chatId = safeInteger(row.chatId, 'known_chats.chat_id')
    if (chatId === 0) {
      throw new Error('known_chats.chat_id cannot be zero')
    }
    const ids = chatId > 0 ? privateIds : communityIds
    if (ids.has(chatId)) {
      throw new Error('known_chats contains a duplicate chat_id')
    }
    ids.add(chatId)
    const deletions = safeInteger(
      row.successfulDeletions,
      'known_chats.successful_deletions'
    )
    if (deletions < 0) {
      throw new Error('known_chats.successful_deletions cannot be negative')
    }
    successfulDeletionCount += deletions
    if (!Number.isSafeInteger(successfulDeletionCount)) {
      throw new Error('successful deletion total is too large')
    }

    const processed = safeInteger(
      row.processedMessages,
      'known_chats.processed_messages'
    )
    if (processed < 0) {
      throw new Error('known_chats.processed_messages cannot be negative')
    }
    processedMessageCount += processed
    if (!Number.isSafeInteger(processedMessageCount)) {
      throw new Error('processed message total is too large')
    }
  }

  if (!rows.length) {
    throw new Error('Jev known_chats is empty')
  }

  return {
    privateIds,
    communityIds,
    processedMessageCount,
    successfulDeletionCount,
  }
}

export async function getJevAntispamStats(
  databaseUrl: string,
  telegramToken: string
): Promise<JevAntispamCollection> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    query_timeout: 10000,
    statement_timeout: 10000,
    application_name: 'borodutch_stats_jev',
  })

  let rows: KnownChatRow[]
  try {
    const result = await pool.query<KnownChatRow>(`
      SELECT
        chat_id::text AS "chatId",
        successful_deletions::text AS "successfulDeletions",
        COALESCE(
          to_jsonb(known_chats)->>'processed_messages',
          '0'
        ) AS "processedMessages"
      FROM known_chats
    `)
    rows = result.rows
  } finally {
    await pool.end()
  }

  const aggregate = aggregateKnownChats(rows)
  const bot = await getBotUsersFromChatIdsOptimized(
    '@jev_antispam_bot',
    telegramToken,
    aggregate.privateIds,
    aggregate.communityIds,
    {
      refreshAll: true,
    }
  )
  const stats: JevAntispamStats = {
    knownChatCount: aggregate.privateIds.size + aggregate.communityIds.size,
    privateChatCount: aggregate.privateIds.size,
    reachableCommunityCount:
      bot.reachability.reachableGroupChatCount +
      bot.reachability.reachableChannelCount,
    combinedCommunityAudience:
      bot.reachability.totalGroupAudienceEstimate,
    successfulDeletionCount: aggregate.successfulDeletionCount,
    processedMessageCount: aggregate.processedMessageCount,
  }

  return { stats, bot }
}
