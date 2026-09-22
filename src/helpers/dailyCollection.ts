import { collectStats, ShadowCollectionResult } from './shadowCollection'
import {
  PublishedStatsSnapshot,
  publishedSnapshotFromCollection,
  writePublishedSnapshotAtomically,
} from './publishedSnapshot'

export async function collectAndPublish(
  outputPath: string,
  collect: () => Promise<ShadowCollectionResult> = collectStats,
  now: () => Date = function () {
    return new Date()
  }
): Promise<PublishedStatsSnapshot> {
  const result = await collect()
  const snapshot = publishedSnapshotFromCollection(result, now())
  writePublishedSnapshotAtomically(outputPath, snapshot)
  return snapshot
}
