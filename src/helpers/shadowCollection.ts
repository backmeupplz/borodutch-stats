import axios from 'axios'
import { createConnection } from 'mongoose'
import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import {
  BotUsersMetrics,
  getBotUsersForSpellerOptimized,
  getBotUsersOptimized,
} from './optimizedGetBotUsers'
import {
  normalizeShieldyStats,
  shieldyStatsUrl,
  shieldyUserCount,
} from './shieldy'
import { getJevAntispamStats, JevAntispamStats } from './jevAntispam'

export interface ShadowCollectionResult {
  mode: 'shadow'
  published: false
  generatedAt: string
  durationSeconds: number
  total: number
  components: { [name: string]: number }
  bots: { [name: string]: BotUsersMetrics }
  projects: {
    jevAntispam: JevAntispamStats
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error('Missing required environment variable ' + name)
  }
  return value
}

async function collectionCount(uri: string, collectionName: string) {
  const connection = await (createConnection(uri, {
    useNewUrlParser: true,
  } as any) as any).asPromise()
  try {
    return await connection.collection(collectionName).find().count()
  } finally {
    await connection.close()
  }
}

async function goldenBorodutchCount() {
  const html = (await axios.get('https://t.me/golden_borodutch')).data
  const match = /<div class="tgme_page_extra">(.+) \D+/.exec(html)
  if (!match) {
    throw new Error('Golden Borodutch subscriber count is unavailable')
  }
  const count = parseInt(match[1].replace(/\s/g, ''), 10)
  if (!Number.isFinite(count)) {
    throw new Error('Golden Borodutch subscriber count is invalid')
  }
  return count
}

export function writeResultAtomically(result: ShadowCollectionResult) {
  const outputPath = resolve(
    process.env.STATS_SHADOW_RESULT_PATH || 'shadow-results/latest.json'
  )
  if (/[/\\]usercount\.txt$/.test(outputPath)) {
    throw new Error('Shadow output cannot target production usercount.txt')
  }
  mkdirSync(dirname(outputPath), { recursive: true })
  const temporaryPath = outputPath + '.tmp'
  writeFileSync(temporaryPath, JSON.stringify(result, null, 2) + '\n')
  renameSync(temporaryPath, outputPath)
}

export async function collectStats(): Promise<ShadowCollectionResult> {
  const startedAt = Date.now()
  const shieldyStats = normalizeShieldyStats((await axios(shieldyStatsUrl)).data)
  const shieldy = shieldyUserCount(shieldyStats)
  if (shieldy === undefined) {
    throw new Error('Shieldy user count is unavailable')
  }

  const fixedCounts = await Promise.all([
    goldenBorodutchCount(),
    collectionCount(requiredEnv('TODORANT'), 'users'),
    collectionCount(requiredEnv('TEMPLY'), 'users'),
  ])

  const botResults = await Promise.all([
    getBotUsersForSpellerOptimized(
      '@check_my_text_bot',
      requiredEnv('CHECK_MY_TEXT_BOT'),
      requiredEnv('CHECK_MY_TEXT_BOT_TOKEN')
    ),
    getBotUsersOptimized(
      '@randymbot',
      requiredEnv('RANDYM'),
      requiredEnv('RANDYM_TOKEN'),
      'chatId',
      'chats',
      {
        additionalChatSources: [
          { collectionName: 'raffles', fieldNames: ['chatId'] },
          {
            collectionName: 'chats',
            fieldNames: ['editedChatId', 'adminChatIds'],
          },
        ],
      }
    ),
    getBotUsersOptimized(
      '@banofbot',
      requiredEnv('BANOFBOT'),
      requiredEnv('BANOFBOT_TOKEN')
    ),
    getBotUsersOptimized(
      '@voicy_bot',
      requiredEnv('VOICY'),
      requiredEnv('VOICY_TOKEN'),
      'id',
      'chats',
      {
        additionalChatSources: [
          {
            collectionName: 'transcriptionjobs',
            fieldNames: ['chatId', 'telegramChatId'],
          },
        ],
      }
    ),
    getJevAntispamStats(
      requiredEnv('JEV_DATABASE_URL'),
      requiredEnv('JEV_TELEGRAM_BOT_TOKEN')
    ),
  ])
  const jevAntispam = botResults[4]

  const bots = {
    speller: botResults[0],
    randy: botResults[1],
    banofbot: botResults[2],
    voicy: botResults[3],
    jevAntispam: jevAntispam.bot,
  }
  const components = {
    shieldy: shieldy,
    goldenBorodutch: fixedCounts[0],
    todorant: fixedCounts[1],
    temply: fixedCounts[2],
    speller: bots.speller.legacyUserCount,
    randy: bots.randy.legacyUserCount,
    banofbot: bots.banofbot.legacyUserCount,
    voicy: bots.voicy.legacyUserCount,
    jevAntispam: bots.jevAntispam.legacyUserCount,
  }
  const total = Object.keys(components).reduce(function (sum, key) {
    return sum + components[key]
  }, 0)
  const result: ShadowCollectionResult = {
    mode: 'shadow',
    published: false,
    generatedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    total: total,
    components: components,
    bots: bots,
    projects: {
      jevAntispam: jevAntispam.stats,
    },
  }
  return result
}

export async function runShadowCollection(): Promise<ShadowCollectionResult> {
  const result = await collectStats()
  writeResultAtomically(result)
  return result
}
