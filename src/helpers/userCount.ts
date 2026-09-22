import { appendFileSync, mkdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { emptyReachabilityMetrics } from './reachability'
import {
  aggregateReachability,
  historyWithSnapshot,
  installPublishedSeed,
  publishedSnapshotMtime,
  readPublishedSnapshot,
} from './publishedSnapshot'
import { collectAndPublish } from './dailyCollection'
import type { JevAntispamStats } from './jevAntispam'
import {
  collectionDelay,
  failedCollectionRetryMs,
  withCollectionLock,
} from './collectionSchedule'

const Telegraf = require('telegraf')

const userCountPath = resolve(
  process.env.STATS_USER_COUNT_HISTORY_PATH ||
    `${__dirname}/../../usercount/usercount.txt`
)
const minimumValidUserCount = 100_000_000
const suspiciousHistoryWindow = 25

try {
  mkdirSync(resolve(userCountPath, '..'), { recursive: true })
  readFileSync(userCountPath, 'utf8')
} catch (_) {
  appendFileSync(userCountPath, '')
  console.log('usercount.txt created')
}

function parseUserCountHistory() {
  const history = readFileSync(userCountPath, 'utf8')
  const historyItems = history
    .split('\n')
    .filter((value) => !!value)
    .map((item) => item.split(' '))
  const prefix = historyItems.slice(0, -suspiciousHistoryWindow)
  const recentItems = historyItems.slice(-suspiciousHistoryWindow).filter(
    (item) => Number(item[1]) >= minimumValidUserCount
  )
  return prefix.concat(recentItems)
}

let userCountHistory = parseUserCountHistory()
const lastUserCount =
  Number(userCountHistory[userCountHistory.length - 1]?.[1]) || 65345412

console.log('Recovered user count', lastUserCount)

export const userCount = {
  count: lastUserCount,
  history: userCountHistory,
  reachability: {} as { [index: string]: any },
}

export const userCountSeparate = {} as { [index: string]: number }

export const userCountReachability = {
  total: emptyReachabilityMetrics(),
  bots: {} as { [index: string]: any },
}

export const jevAntispamStats = {} as JevAntispamStats

const publishedSnapshotPath = resolve(
  process.env.STATS_PUBLISHED_RESULT_PATH ||
    `${__dirname}/../../usercount/latest.json`
)
const publishedSeedPath = resolve(
  process.env.STATS_PUBLISHED_SEED_PATH ||
    `${__dirname}/../../published-snapshots/latest.json`
)
let appliedSnapshotMtime: number | undefined

export function refreshPublishedStatsSnapshot(force = false) {
  try {
    installPublishedSeed(publishedSeedPath, publishedSnapshotPath)
    const mtime = publishedSnapshotMtime(publishedSnapshotPath)
    if (mtime === undefined || (!force && mtime === appliedSnapshotMtime)) {
      return false
    }
    const snapshot = readPublishedSnapshot(publishedSnapshotPath)
    const history = historyWithSnapshot(parseUserCountHistory(), snapshot)

    for (const key of Object.keys(userCountSeparate)) {
      delete userCountSeparate[key]
    }
    Object.assign(userCountSeparate, snapshot.components)

    for (const key of Object.keys(jevAntispamStats)) {
      delete (jevAntispamStats as any)[key]
    }
    if (snapshot.projects) {
      Object.assign(jevAntispamStats, snapshot.projects.jevAntispam)
    }

    for (const key of Object.keys(userCountReachability.bots)) {
      delete userCountReachability.bots[key]
    }
    Object.assign(userCountReachability.bots, snapshot.bots)
    Object.assign(userCountReachability.total, aggregateReachability(snapshot))

    userCount.count = snapshot.total
    userCount.history = history
    userCount.reachability = userCountReachability
    appliedSnapshotMtime = mtime
    return true
  } catch (err) {
    console.error('+ keeping last known good published user count:', err)
    return false
  }
}

/**
 * Collect and atomically publish one complete daily snapshot.
 */
export async function runCollection(): Promise<{
  count: number
  reachability: typeof userCountReachability
  perBot: typeof userCountSeparate
}> {
  return withCollectionLock(publishedSnapshotPath + '.collection.lock', async () => {
    installPublishedSeed(publishedSeedPath, publishedSnapshotPath)
    const delay = collectionDelay(
      readPublishedSnapshot(publishedSnapshotPath).publishedAt
    )
    if (delay > 0) {
      refreshPublishedStatsSnapshot(true)
      console.log(
        '+ daily stats collection skipped; next due ' +
          new Date(Date.now() + delay).toISOString()
      )
      return {
        count: userCount.count,
        reachability: userCountReachability,
        perBot: userCountSeparate,
      }
    }
    return collectNow()
  })
}

async function collectNow() {
  const startedAt = Date.now()
  const snapshot = await collectAndPublish(publishedSnapshotPath)

  try {
    appendFileSync(
      userCountPath,
      `${Date.parse(snapshot.generatedAt)} ${snapshot.total}\n`
    )
  } catch (err) {
    console.error('+ published snapshot but could not append history:', err)
  }

  if (!refreshPublishedStatsSnapshot(true)) {
    throw new Error('Published snapshot could not be loaded after publication')
  }

  const durationHours = (
    (Date.now() - startedAt) /
    1000 /
    60 /
    60
  ).toFixed(3)
  const reachability = userCountReachability.total
  console.log(
    '+ got overall number of users ' + snapshot.total + ' in ' + durationHours + 'h'
  )
  notifyAdmin(
    'got overall number of users ' + snapshot.total + ' in ' + durationHours + 'h' +
      '\nreachability: total=' + reachability.reachableChatCount +
      ' private=' + reachability.reachablePrivateChatCount +
      ' group=' + reachability.reachableGroupChatCount +
      ' channel=' + reachability.reachableChannelCount +
      ' audience=' + reachability.totalGroupAudienceEstimate +
      ' unreachable=' + reachability.unreachableChatCount
  )

  return {
    count: snapshot.total,
    reachability: userCountReachability,
    perBot: userCountSeparate,
  }
}

let collectionTimer: ReturnType<typeof setTimeout> | undefined

export function startDailyCollection() {
  if (collectionTimer) {
    return
  }

  const schedule = (delay: number) => {
    console.log(
      '+ daily stats next check ' + new Date(Date.now() + delay).toISOString()
    )
    collectionTimer = setTimeout(collect, delay)
    collectionTimer.unref()
  }
  const collect = async () => {
    try {
      await runCollection()
      schedule(Math.max(1000, collectionDelay(
        readPublishedSnapshot(publishedSnapshotPath).publishedAt
      )))
    } catch (err) {
      console.error('+ daily stats collection failed; retrying in one hour:', err)
      schedule(failedCollectionRetryMs)
    }
  }

  // Keep boot warmup, but never count merely because the process restarted.
  try {
    schedule(Math.max(60 * 1000, collectionDelay(
      readPublishedSnapshot(publishedSnapshotPath).publishedAt
    )))
  } catch (_) {
    schedule(60 * 1000)
  }
}

function updateStats() {
  try {
    userCountHistory = parseUserCountHistory()
    userCount.history = userCountHistory
    if (!refreshPublishedStatsSnapshot(true)) {
      userCount.count =
        Number(userCountHistory[userCountHistory.length - 1]?.[1]) ||
        userCount.count
    }
  } catch (err) {
    console.error(err)
  }
  console.log('+ user count recalculation is disabled')
}

function notifyAdmin(message: string) {
  if (!process.env.TOKEN || !process.env.ADMIN) {
    return
  }
  const bot = new Telegraf(process.env.TOKEN)
  bot.telegram.sendMessage(process.env.ADMIN, message).catch((err) => {
    console.log(err)
  })
}

updateStats()
