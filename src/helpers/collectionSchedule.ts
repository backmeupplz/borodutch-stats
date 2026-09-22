import { closeSync, openSync, unlinkSync } from 'fs'

export const dailyCollectionIntervalMs = 24 * 60 * 60 * 1000
export const failedCollectionRetryMs = 60 * 60 * 1000

export function collectionDelay(publishedAt: string, now = Date.now()) {
  const completed = Date.parse(publishedAt)
  if (!Number.isFinite(completed)) {
    throw new Error('Invalid successful collection timestamp')
  }
  return Math.max(0, completed + dailyCollectionIntervalMs - now)
}

// Shared-volume exclusive file also covers CLI runs and rollout overlap.
// Fail closed after a killed process: inspect/remove a stale lock only after
// confirming no collector is running, rather than risk overlapping publishers.
export async function withCollectionLock<T>(path: string, collect: () => Promise<T>) {
  const fd = openSync(path, 'wx')
  try {
    return await collect()
  } finally {
    closeSync(fd)
    unlinkSync(path)
  }
}
