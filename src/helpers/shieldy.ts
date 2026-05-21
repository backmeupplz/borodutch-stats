export const shieldyStatsUrl = 'http://142.93.135.209:1339/stats'

export type ShieldyDailyPoint = {
  _id: number | null
  count: number
}

export type ShieldyStats = {
  chatDaily?: ShieldyDailyPoint[]
  chatCount?: number
  userCount?: number
  userCountSource?: 'userCount' | 'chatCount' | 'chatDaily'
  [key: string]: any
}

function finiteNumber(value: any): number | undefined {
  if (typeof value !== 'number' || !isFinite(value)) {
    return undefined
  }
  return value
}

export function shieldyUserCount(stats: ShieldyStats): number | undefined {
  return (
    finiteNumber(stats.userCount) ||
    finiteNumber(stats.chatCount) ||
    finiteNumber(stats.chatDaily?.[stats.chatDaily.length - 1]?.count)
  )
}

export function normalizeShieldyStats(payload: any): ShieldyStats {
  const rawStats = payload && payload.shieldy ? payload.shieldy : payload || {}
  const normalized: ShieldyStats = {
    ...rawStats,
  }

  if (Array.isArray(rawStats.chatDaily)) {
    normalized.chatDaily = rawStats.chatDaily.slice().reverse()
  }

  const fallbackUserCount = shieldyUserCount(rawStats)
  if (fallbackUserCount !== undefined) {
    normalized.userCount = fallbackUserCount
    normalized.userCountSource =
      finiteNumber(rawStats.userCount) !== undefined
        ? 'userCount'
        : finiteNumber(rawStats.chatCount) !== undefined
          ? 'chatCount'
          : 'chatDaily'
  }

  return normalized
}
