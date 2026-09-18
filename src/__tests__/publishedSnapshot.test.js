const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  aggregateReachability,
  historyWithSnapshot,
  installPublishedSeed,
  readPublishedSnapshot,
  validatePublishedSnapshot,
  writePublishedSnapshotAtomically,
} = require('../../dist/helpers/publishedSnapshot')

function metrics(overrides = {}) {
  return {
    reachableChatCount: 10,
    reachablePrivateChatCount: 6,
    reachableGroupChatCount: 3,
    reachableChannelCount: 1,
    totalGroupAudienceEstimate: 100,
    unavailableGroupMemberCount: 2,
    unreachableChatCount: 4,
    ...overrides,
  }
}

function bot(legacyUserCount, overrides = {}) {
  return {
    legacyUserCount,
    reachability: metrics(overrides),
    inventory: {
      privateIds: 6,
      groupIds: 8,
      checkpointedGroups: 8,
      sources: [],
    },
  }
}

function snapshot() {
  const components = {
    shieldy: 61049739,
    goldenBorodutch: 65705,
    todorant: 39535,
    temply: 12175,
    speller: 203669,
    randy: 24542910,
    banofbot: 14492133,
    voicy: 6281537,
  }
  return {
    schemaVersion: 1,
    mode: 'published',
    published: true,
    generatedAt: '2026-09-18T10:15:46.520Z',
    publishedAt: '2026-09-18T17:00:00.000Z',
    total: Object.values(components).reduce((sum, count) => sum + count, 0),
    components,
    bots: {
      speller: bot(components.speller),
      randy: bot(components.randy),
      banofbot: bot(components.banofbot),
      voicy: bot(components.voicy),
    },
  }
}

describe('published stats snapshots', () => {
  test('accepts a complete internally consistent result', () => {
    expect(validatePublishedSnapshot(snapshot()).total).toBe(106687403)
  })

  test('rejects partial or inconsistent totals', () => {
    const value = snapshot()
    value.total -= 1
    expect(() => validatePublishedSnapshot(value)).toThrow(
      'total does not equal the required component sum'
    )
  })

  test('rejects a bot total that differs from its component', () => {
    const value = snapshot()
    value.bots.voicy.legacyUserCount -= 1
    expect(() => validatePublishedSnapshot(value)).toThrow(
      'components.voicy does not match its bot result'
    )
  })

  test('writes atomically and installs a newer valid seed', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-published-'))
    const seedPath = path.join(directory, 'seed.json')
    const outputPath = path.join(directory, 'latest.json')
    writePublishedSnapshotAtomically(seedPath, snapshot())

    expect(installPublishedSeed(seedPath, outputPath)).toBe(true)
    expect(readPublishedSnapshot(outputPath).total).toBe(106687403)
    expect(fs.existsSync(outputPath + '.tmp')).toBe(false)
    expect(installPublishedSeed(seedPath, outputPath)).toBe(false)
  })

  test('keeps valid recent history, removes partial results, and appends once', () => {
    const value = snapshot()
    const timestamp = String(Date.parse(value.generatedAt))
    const history = [
      ['1', '109000000'],
      ['2', '24608082'],
      ['3', '47772188'],
      [timestamp, '1'],
    ]
    const result = historyWithSnapshot(history, value)

    expect(result).toEqual([
      ['1', '109000000'],
      [timestamp, '106687403'],
    ])
    expect(historyWithSnapshot(result, value)).toEqual(result)
  })

  test('aggregates reachability for every required bot', () => {
    const value = snapshot()
    value.bots.randy.reachability = metrics({ reachableChatCount: 20 })

    expect(aggregateReachability(value)).toMatchObject({
      reachableChatCount: 50,
      totalGroupAudienceEstimate: 400,
      unreachableChatCount: 16,
    })
  })
})
