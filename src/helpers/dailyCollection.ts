import {
  collectLiveHeadlineInputs,
  LiveHeadlineInputs,
  ShadowCollectionResult,
} from './shadowCollection'
import {
  PublishedStatsSnapshot,
  publishedSnapshotFromCollection,
  readPublishedSnapshot,
  writePublishedSnapshotAtomically,
} from './publishedSnapshot'
import {
  JevAntispamHistoryPoint,
  JevAntispamStats,
} from './jevAntispam'

export function historyWithJevStats(
  history: JevAntispamHistoryPoint[],
  stats: JevAntispamStats,
  generatedAt: Date
): JevAntispamHistoryPoint[] {
  const knownChatCount = requiredCounter(
    stats.knownChatCount,
    'knownChatCount'
  )
  const processedMessageCount = requiredCounter(
    stats.processedMessageCount,
    'processedMessageCount'
  )
  const successfulDeletionCount = requiredCounter(
    stats.successfulDeletionCount,
    'successfulDeletionCount'
  )
  const date = generatedAt.toISOString().slice(0, 10)
  return history.filter(function (point) {
    return point.date !== date
  }).concat([{
    date: date,
    knownChatCount: knownChatCount,
    processedMessageCount: processedMessageCount,
    successfulDeletionCount: successfulDeletionCount,
  }])
}

function requiredCounter(value: any, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Jev ' + name + ' must be a non-negative integer')
  }
  return value
}

export function dailyCollectionFromSnapshot(
  previous: PublishedStatsSnapshot,
  live: LiveHeadlineInputs,
  generatedAt: Date = new Date()
): ShadowCollectionResult {
  const generatedAtDate = generatedAt
  const jevAntispam = Object.assign({}, live.jevAntispam.stats, {
    history: historyWithJevStats(
      previous.projects?.jevAntispam.history || [],
      live.jevAntispam.stats,
      generatedAtDate
    ),
  })
  const components = Object.assign({}, previous.components, {
    shieldy: live.shieldy,
    goldenBorodutch: live.goldenBorodutch,
    todorant: live.todorant,
    temply: live.temply,
    jevAntispam: live.jevAntispam.bot.legacyUserCount,
  })
  const bots = Object.assign({}, previous.bots, {
    jevAntispam: live.jevAntispam.bot,
  })

  return {
    mode: 'shadow',
    published: false,
    generatedAt: generatedAtDate.toISOString(),
    durationSeconds: 0,
    total: Object.keys(components).reduce(function (sum, name) {
      return sum + components[name]
    }, 0),
    components: components,
    bots: bots,
    projects: {
      jevAntispam: jevAntispam,
    },
  }
}

export async function collectDailyStats(
  previous: PublishedStatsSnapshot,
  collectLive: () => Promise<LiveHeadlineInputs> = collectLiveHeadlineInputs,
  now: () => Date = function () {
    return new Date()
  },
  timeoutMs: number = 30 * 60 * 1000
): Promise<ShadowCollectionResult> {
  const startedAt = Date.now()
  let timeout: ReturnType<typeof setTimeout>
  const live = await Promise.race([
    collectLive(),
    new Promise<never>(function (_, reject) {
      timeout = setTimeout(function () {
        reject(new Error('Daily stats collection timed out'))
      }, timeoutMs)
      timeout.unref()
    }),
  ]).finally(function () {
    clearTimeout(timeout)
  })
  const result = dailyCollectionFromSnapshot(
    previous,
    live,
    now()
  )
  result.durationSeconds = Math.round((Date.now() - startedAt) / 1000)
  return result
}

export async function collectAndPublish(
  outputPath: string,
  collect: (
    previous: PublishedStatsSnapshot
  ) => Promise<ShadowCollectionResult> = collectDailyStats,
  now: () => Date = function () {
    return new Date()
  }
): Promise<PublishedStatsSnapshot> {
  const previous = readPublishedSnapshot(outputPath)
  const result = await collect(previous)
  const snapshot = publishedSnapshotFromCollection(result, now())
  writePublishedSnapshotAtomically(outputPath, snapshot)
  return snapshot
}
