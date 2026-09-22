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

export function dailyCollectionFromSnapshot(
  previous: PublishedStatsSnapshot,
  live: LiveHeadlineInputs,
  generatedAt: Date = new Date()
): ShadowCollectionResult {
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
    generatedAt: generatedAt.toISOString(),
    durationSeconds: 0,
    total: Object.keys(components).reduce(function (sum, name) {
      return sum + components[name]
    }, 0),
    components: components,
    bots: bots,
    projects: {
      jevAntispam: live.jevAntispam.stats,
    },
  }
}

export async function collectDailyStats(
  previous: PublishedStatsSnapshot,
  collectLive: () => Promise<LiveHeadlineInputs> = collectLiveHeadlineInputs,
  now: () => Date = function () {
    return new Date()
  }
): Promise<ShadowCollectionResult> {
  const startedAt = Date.now()
  const result = dailyCollectionFromSnapshot(
    previous,
    await collectLive(),
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
