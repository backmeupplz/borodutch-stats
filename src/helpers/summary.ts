import { stats } from './stats'

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
  return trimHeavyData(stats)
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
