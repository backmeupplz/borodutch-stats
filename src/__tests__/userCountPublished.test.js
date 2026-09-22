const fs = require('fs')
const os = require('os')
const path = require('path')
const { writePublishedSnapshotAtomically } = require('../../dist/helpers/publishedSnapshot')

function bot(legacyUserCount) {
  return {
    legacyUserCount,
    reachability: {
      reachableChatCount: 1,
      reachablePrivateChatCount: 1,
      reachableGroupChatCount: 0,
      reachableChannelCount: 0,
      totalGroupAudienceEstimate: 0,
      unavailableGroupMemberCount: 0,
      unreachableChatCount: 0,
    },
    inventory: {
      privateIds: 1,
      groupIds: 0,
      checkpointedGroups: 0,
      sources: [],
    },
  }
}

describe('published user count startup', () => {
  const originalHistoryPath = process.env.STATS_USER_COUNT_HISTORY_PATH
  const originalResultPath = process.env.STATS_PUBLISHED_RESULT_PATH

  afterEach(() => {
    jest.resetModules()
    if (originalHistoryPath === undefined) {
      delete process.env.STATS_USER_COUNT_HISTORY_PATH
    } else {
      process.env.STATS_USER_COUNT_HISTORY_PATH = originalHistoryPath
    }
    if (originalResultPath === undefined) {
      delete process.env.STATS_PUBLISHED_RESULT_PATH
    } else {
      process.env.STATS_PUBLISHED_RESULT_PATH = originalResultPath
    }
  })

  test('published snapshot wins over stale and partial history on startup', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-user-count-'))
    const historyPath = path.join(directory, 'usercount.txt')
    const resultPath = path.join(directory, 'latest.json')
    fs.writeFileSync(
      historyPath,
      '1 110000000\n2 24608082\n3 47772188\n'
    )
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
    writePublishedSnapshotAtomically(resultPath, {
      schemaVersion: 1,
      mode: 'published',
      published: true,
      generatedAt: '2026-09-18T10:15:46.520Z',
      publishedAt: '2026-09-18T17:00:00.000Z',
      total: 106687403,
      components,
      bots: {
        speller: bot(components.speller),
        randy: bot(components.randy),
        banofbot: bot(components.banofbot),
        voicy: bot(components.voicy),
      },
    })
    process.env.STATS_USER_COUNT_HISTORY_PATH = historyPath
    process.env.STATS_PUBLISHED_RESULT_PATH = resultPath
    jest.resetModules()

    const data = require('../../dist/helpers/userCount')

    expect(data.userCount.count).toBe(106687403)
    expect(data.userCountSeparate).toEqual(components)
    expect(data.userCount.history).toEqual([
      ['1', '110000000'],
      [String(Date.parse('2026-09-18T10:15:46.520Z')), '106687403'],
    ])
  })

  test('replaces optional Jev history when a newer pre-history snapshot loads', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-user-count-'))
    const historyPath = path.join(directory, 'usercount.txt')
    const resultPath = path.join(directory, 'latest.json')
    fs.writeFileSync(historyPath, '')
    const components = {
      shieldy: 61049739,
      goldenBorodutch: 65705,
      todorant: 39535,
      temply: 12175,
      speller: 203669,
      randy: 24542910,
      banofbot: 14492133,
      voicy: 6281537,
      jevAntispam: 1,
    }
    const bots = {
      speller: bot(components.speller),
      randy: bot(components.randy),
      banofbot: bot(components.banofbot),
      voicy: bot(components.voicy),
      jevAntispam: bot(components.jevAntispam),
    }
    const jevAntispam = {
      knownChatCount: 1,
      privateChatCount: 1,
      reachableCommunityCount: 0,
      combinedCommunityAudience: 0,
      successfulDeletionCount: 7,
      processedMessageCount: 11,
      history: [{
        date: '2026-09-19',
        knownChatCount: 1,
        processedMessageCount: 11,
        successfulDeletionCount: 7,
      }],
    }
    const total = Object.values(components).reduce((sum, value) => sum + value, 0)

    writePublishedSnapshotAtomically(resultPath, {
      schemaVersion: 2,
      mode: 'published',
      published: true,
      generatedAt: '2026-09-19T10:15:46.520Z',
      publishedAt: '2026-09-19T17:00:00.000Z',
      total,
      components,
      bots,
      projects: { jevAntispam },
    })
    process.env.STATS_USER_COUNT_HISTORY_PATH = historyPath
    process.env.STATS_PUBLISHED_RESULT_PATH = resultPath
    jest.resetModules()

    const data = require('../../dist/helpers/userCount')
    expect(data.jevAntispamStats.processedMessageCount).toBe(11)

    writePublishedSnapshotAtomically(resultPath, {
      schemaVersion: 2,
      mode: 'published',
      published: true,
      generatedAt: '2026-09-20T10:15:46.520Z',
      publishedAt: '2026-09-20T17:00:00.000Z',
      total,
      components,
      bots,
      projects: {
        jevAntispam: {
          knownChatCount: 1,
          privateChatCount: 1,
          reachableCommunityCount: 0,
          combinedCommunityAudience: 0,
          successfulDeletionCount: 7,
        },
      },
    })

    expect(data.refreshPublishedStatsSnapshot(true)).toBe(true)
    expect(data.jevAntispamStats).toEqual({
      knownChatCount: 1,
      privateChatCount: 1,
      reachableCommunityCount: 0,
      combinedCommunityAudience: 0,
      successfulDeletionCount: 7,
    })
  })
})
