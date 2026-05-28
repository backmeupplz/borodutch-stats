import { stats } from './stats'

type CountLabel = 'users' | 'chats'

export type ProjectCountSummary = {
  count: number
  label: CountLabel
  source: string
}

function finitePositiveNumber(value: any): number | undefined {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) {
    return undefined
  }
  return value
}

function count(
  value: any,
  label: CountLabel,
  source: string
): ProjectCountSummary | undefined {
  const parsed = finitePositiveNumber(value)
  if (parsed === undefined) {
    return undefined
  }

  return { count: parsed, label, source }
}

function firstCount(
  ...counts: Array<ProjectCountSummary | undefined>
): ProjectCountSummary | undefined {
  return counts.find(Boolean)
}

export function deriveProjectCounts(source: any): {
  [project: string]: ProjectCountSummary
} {
  const result: { [project: string]: ProjectCountSummary } = {}

  const userCountSeparate = source.userCountSeparate || {}
  for (const key of Object.keys(userCountSeparate)) {
    const projectCount = count(
      userCountSeparate[key],
      'users',
      'userCountSeparate'
    )
    if (projectCount) {
      result[key] = projectCount
    }
  }

  const fallbacks: { [project: string]: ProjectCountSummary | undefined } = {
    shieldy: firstCount(
      count(source.shieldy?.userCount, 'users', 'shieldy.userCount'),
      count(source.shieldy?.chatCount, 'chats', 'shieldy.chatCount')
    ),
    voicy: count(
      source.voicy?.stats?.chatCount,
      'chats',
      'voicy.stats.chatCount'
    ),
    banofbot: firstCount(
      count(source.banofbot?.userCount, 'users', 'banofbot.userCount'),
      count(source.banofbot?.chatCount, 'chats', 'banofbot.chatCount')
    ),
    randy: count(source.randym?.chatCount, 'chats', 'randym.chatCount'),
    todorant: count(
      source.todorant?.db?.userCount,
      'users',
      'todorant.db.userCount'
    ),
    temply: count(source.temply?.userCount, 'users', 'temply.userCount'),
    checkMyTextBot: count(
      source.checkMyTextBot?.userCount,
      'users',
      'checkMyTextBot.userCount'
    ),
  }

  for (const key of Object.keys(fallbacks)) {
    if (!result[key] && fallbacks[key]) {
      result[key] = fallbacks[key] as ProjectCountSummary
    }
  }

  return result
}

function deriveUserCountSeparate(source: any): { [project: string]: number } {
  const result: { [project: string]: number } = {}
  const projectCounts = deriveProjectCounts(source)

  for (const key of Object.keys(projectCounts)) {
    if (projectCounts[key].label === 'users') {
      result[key] = projectCounts[key].count
    }
  }

  return result
}

function trimHeavyData(value: any): any {
  if (Array.isArray(value)) {
    return undefined
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const result: any = {}
  for (const key of Object.keys(value)) {
    const trimmed = trimHeavyData(value[key])
    if (trimmed !== undefined) {
      result[key] = trimmed
    }
  }
  return result
}

export function summary() {
  const trimmed = trimHeavyData(stats)
  const projectCounts = deriveProjectCounts(stats)
  const userCountSeparate = deriveUserCountSeparate(stats)

  return {
    ...trimmed,
    projectCounts,
    userCountSeparate,
  }
}

const projectStatsKeys: { [project: string]: string[] } = {
  randy: ['randym'],
  speller: ['checkMyTextBot'],
}

export function projectStats(project: string) {
  const keys = projectStatsKeys[project] || [project]
  const result: any = {}
  for (const key of keys) {
    if (stats[key] !== undefined) {
      result[key] = stats[key]
    }
  }
  return result
}
