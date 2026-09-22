import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs'
import { dirname, resolve } from 'path'
import { BotUsersMetrics } from './optimizedGetBotUsers'
import { emptyReachabilityMetrics, ReachabilityMetrics } from './reachability'
import type { JevAntispamStats } from './jevAntispam'
import type { ShadowCollectionResult } from './shadowCollection'

const schema1Components = [
  'shieldy',
  'goldenBorodutch',
  'todorant',
  'temply',
  'speller',
  'randy',
  'banofbot',
  'voicy',
]
const schema1Bots = ['speller', 'randy', 'banofbot', 'voicy']
const metricKeys: Array<keyof ReachabilityMetrics> = [
  'reachableChatCount',
  'reachablePrivateChatCount',
  'reachableGroupChatCount',
  'reachableChannelCount',
  'totalGroupAudienceEstimate',
  'unavailableGroupMemberCount',
  'unreachableChatCount',
]

export interface PublishedStatsSnapshot {
  schemaVersion: 1 | 2
  mode: 'published'
  published: true
  generatedAt: string
  publishedAt: string
  total: number
  components: { [name: string]: number }
  bots: { [name: string]: BotUsersMetrics }
  projects?: {
    jevAntispam: JevAntispamStats
  }
}

function nonNegativeInteger(value: any, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(name + ' must be a non-negative integer')
  }
  return value
}

function validDate(value: any, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(name + ' must be an ISO date')
  }
  return value
}

function validateBot(name: string, value: any): BotUsersMetrics {
  if (!value || typeof value !== 'object') {
    throw new Error('bots.' + name + ' is required')
  }
  nonNegativeInteger(value.legacyUserCount, 'bots.' + name + '.legacyUserCount')
  if (!value.reachability || typeof value.reachability !== 'object') {
    throw new Error('bots.' + name + '.reachability is required')
  }
  for (const key of metricKeys) {
    nonNegativeInteger(
      value.reachability[key],
      'bots.' + name + '.reachability.' + key
    )
  }
  if (!value.inventory || typeof value.inventory !== 'object') {
    throw new Error('bots.' + name + '.inventory is required')
  }
  nonNegativeInteger(value.inventory.privateIds, 'bots.' + name + '.inventory.privateIds')
  nonNegativeInteger(value.inventory.groupIds, 'bots.' + name + '.inventory.groupIds')
  nonNegativeInteger(
    value.inventory.checkpointedGroups,
    'bots.' + name + '.inventory.checkpointedGroups'
  )
  if (!Array.isArray(value.inventory.sources)) {
    throw new Error('bots.' + name + '.inventory.sources must be an array')
  }
  return value as BotUsersMetrics
}

export function validatePublishedSnapshot(input: any): PublishedStatsSnapshot {
  if (!input || typeof input !== 'object') {
    throw new Error('Published snapshot must be an object')
  }
  if (
    (input.schemaVersion !== 1 && input.schemaVersion !== 2) ||
    input.mode !== 'published' ||
    input.published !== true
  ) {
    throw new Error('Snapshot is not an explicitly published supported result')
  }
  validDate(input.generatedAt, 'generatedAt')
  validDate(input.publishedAt, 'publishedAt')
  if (!input.components || typeof input.components !== 'object') {
    throw new Error('components are required')
  }

  let componentTotal = 0
  const requiredComponents =
    input.schemaVersion === 2
      ? schema1Components.concat(['jevAntispam'])
      : schema1Components
  for (const name of requiredComponents) {
    componentTotal += nonNegativeInteger(
      input.components[name],
      'components.' + name
    )
  }
  const total = nonNegativeInteger(input.total, 'total')
  const minimumTotal = Number(process.env.STATS_MINIMUM_PUBLISH_TOTAL || 100_000_000)
  if (!Number.isSafeInteger(minimumTotal) || minimumTotal < 0) {
    throw new Error('STATS_MINIMUM_PUBLISH_TOTAL must be a non-negative integer')
  }
  if (total !== componentTotal) {
    throw new Error('total does not equal the required component sum')
  }
  if (total < minimumTotal) {
    throw new Error('total is below the publication safety floor')
  }

  if (!input.bots || typeof input.bots !== 'object') {
    throw new Error('bots are required')
  }
  const requiredBots =
    input.schemaVersion === 2
      ? schema1Bots.concat(['jevAntispam'])
      : schema1Bots
  for (const name of requiredBots) {
    const bot = validateBot(name, input.bots[name])
    if (bot.legacyUserCount !== input.components[name]) {
      throw new Error('components.' + name + ' does not match its bot result')
    }
  }
  if (input.schemaVersion === 2) {
    validateJevAntispam(input)
  }
  return input as PublishedStatsSnapshot
}

function validateJevAntispam(input: any) {
  const value = input.projects && input.projects.jevAntispam
  if (!value || typeof value !== 'object') {
    throw new Error('projects.jevAntispam is required')
  }
  const knownChatCount = nonNegativeInteger(
    value.knownChatCount,
    'projects.jevAntispam.knownChatCount'
  )
  const privateChatCount = nonNegativeInteger(
    value.privateChatCount,
    'projects.jevAntispam.privateChatCount'
  )
  const reachableCommunityCount = nonNegativeInteger(
    value.reachableCommunityCount,
    'projects.jevAntispam.reachableCommunityCount'
  )
  const combinedCommunityAudience = nonNegativeInteger(
    value.combinedCommunityAudience,
    'projects.jevAntispam.combinedCommunityAudience'
  )
  nonNegativeInteger(
    value.successfulDeletionCount,
    'projects.jevAntispam.successfulDeletionCount'
  )

  const bot = input.bots.jevAntispam
  if (knownChatCount !== bot.inventory.privateIds + bot.inventory.groupIds) {
    throw new Error('Jev known chat count does not match its inventory')
  }
  if (privateChatCount !== bot.reachability.reachablePrivateChatCount) {
    throw new Error('Jev private chat count does not match its reachability')
  }
  if (
    reachableCommunityCount !==
    bot.reachability.reachableGroupChatCount +
      bot.reachability.reachableChannelCount
  ) {
    throw new Error('Jev community count does not match its reachability')
  }
  if (
    combinedCommunityAudience !==
    bot.reachability.totalGroupAudienceEstimate
  ) {
    throw new Error('Jev community audience does not match its reachability')
  }
  if (
    bot.legacyUserCount !==
    privateChatCount + combinedCommunityAudience
  ) {
    throw new Error('Jev headline contribution is internally inconsistent')
  }
}

export function publishedSnapshotFromCollection(
  result: ShadowCollectionResult,
  publishedAt: Date = new Date()
): PublishedStatsSnapshot {
  return validatePublishedSnapshot({
    schemaVersion: 2,
    mode: 'published',
    published: true,
    generatedAt: result.generatedAt,
    publishedAt: publishedAt.toISOString(),
    total: result.total,
    components: result.components,
    bots: result.bots,
    projects: result.projects,
  })
}

export function readPublishedSnapshot(path: string): PublishedStatsSnapshot {
  return validatePublishedSnapshot(JSON.parse(readFileSync(resolve(path), 'utf8')))
}

export function writePublishedSnapshotAtomically(
  path: string,
  snapshot: PublishedStatsSnapshot
) {
  validatePublishedSnapshot(snapshot)
  const outputPath = resolve(path)
  mkdirSync(dirname(outputPath), { recursive: true })
  const temporaryPath = outputPath + '.tmp'
  writeFileSync(temporaryPath, JSON.stringify(snapshot, null, 2) + '\n')
  renameSync(temporaryPath, outputPath)
}

export function installPublishedSeed(seedPath: string, outputPath: string) {
  if (!existsSync(seedPath)) {
    return false
  }
  const seed = readPublishedSnapshot(seedPath)
  if (existsSync(outputPath)) {
    try {
      const current = readPublishedSnapshot(outputPath)
      if (Date.parse(current.generatedAt) >= Date.parse(seed.generatedAt)) {
        return false
      }
    } catch (_) {
      // A valid seed may replace a corrupt file. The write below is atomic.
    }
  }
  writePublishedSnapshotAtomically(outputPath, seed)
  return true
}

export function publishedSnapshotMtime(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs
  } catch (_) {
    return undefined
  }
}

export function aggregateReachability(snapshot: PublishedStatsSnapshot) {
  const total = emptyReachabilityMetrics()
  const requiredBots =
    snapshot.schemaVersion === 2
      ? schema1Bots.concat(['jevAntispam'])
      : schema1Bots
  for (const name of requiredBots) {
    const metrics = snapshot.bots[name].reachability
    for (const key of metricKeys) {
      total[key] += metrics[key]
    }
  }
  return total
}

export function historyWithSnapshot(
  history: string[][],
  snapshot: PublishedStatsSnapshot
) {
  const suspiciousWindow = 25
  const minimumValidCount = 100_000_000
  const prefix = history.slice(0, -suspiciousWindow)
  const recent = history.slice(-suspiciousWindow).filter(function (item) {
    const count = Number(item[1])
    return Number.isFinite(count) && count >= minimumValidCount
  })
  const timestamp = String(Date.parse(snapshot.generatedAt))
  const withoutSameTimestamp = prefix.concat(recent).filter(function (item) {
    return item[0] !== timestamp
  })
  return withoutSameTimestamp.concat([[timestamp, String(snapshot.total)]])
}
