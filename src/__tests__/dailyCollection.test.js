const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  collectAndPublish,
  dailyCollectionFromSnapshot,
  historyWithJevStats,
} = require('../../dist/helpers/dailyCollection')
const { readPublishedSnapshot } = require('../../dist/helpers/publishedSnapshot')

function metrics(privateChats = 1, groups = 0, audience = 0, channels = 0) {
  return {
    reachableChatCount: privateChats + groups + channels,
    reachablePrivateChatCount: privateChats,
    reachableGroupChatCount: groups,
    reachableChannelCount: channels,
    totalGroupAudienceEstimate: audience,
    unavailableGroupMemberCount: 0,
    unreachableChatCount: 0,
  }
}

function bot(legacyUserCount) {
  return {
    legacyUserCount,
    reachability: metrics(),
    inventory: {
      privateIds: 1,
      groupIds: 0,
      checkpointedGroups: 0,
      sources: [],
    },
  }
}

function collection() {
  const components = {
    shieldy: 61049739,
    goldenBorodutch: 65705,
    todorant: 39535,
    temply: 12175,
    speller: 203669,
    randy: 24542910,
    banofbot: 14492133,
    voicy: 6281537,
    jevAntispam: 230275,
  }
  const jevBot = {
    legacyUserCount: components.jevAntispam,
    reachability: metrics(508, 122, 229767, 1),
    inventory: {
      privateIds: 508,
      groupIds: 150,
      checkpointedGroups: 150,
      sources: [],
    },
  }
  return {
    mode: 'shadow',
    published: false,
    generatedAt: '2026-09-22T18:00:00.000Z',
    durationSeconds: 1,
    total: Object.values(components).reduce((sum, value) => sum + value, 0),
    components,
    bots: {
      speller: bot(components.speller),
      randy: bot(components.randy),
      banofbot: bot(components.banofbot),
      voicy: bot(components.voicy),
      jevAntispam: jevBot,
    },
    projects: {
      jevAntispam: {
        knownChatCount: 658,
        privateChatCount: 508,
        reachableCommunityCount: 123,
        combinedCommunityAudience: 229767,
        successfulDeletionCount: 5337,
        processedMessageCount: 43210,
        history: [{
          date: '2026-09-22',
          knownChatCount: 658,
          processedMessageCount: 43210,
          successfulDeletionCount: 5337,
        }],
      },
    },
  }
}

function baselineSnapshot() {
  const result = collection()
  const components = { ...result.components }
  const bots = { ...result.bots }
  delete components.jevAntispam
  delete bots.jevAntispam
  return {
    schemaVersion: 1,
    mode: 'published',
    published: true,
    generatedAt: '2026-09-18T10:15:46.520Z',
    publishedAt: '2026-09-18T18:00:14.000Z',
    total: Object.values(components).reduce((sum, value) => sum + value, 0),
    components,
    bots,
  }
}

function writeBaseline(outputPath) {
  fs.writeFileSync(outputPath, JSON.stringify(baselineSnapshot()) + '\n')
}

function liveInputs() {
  const result = collection()
  return {
    shieldy: result.components.shieldy + 10,
    goldenBorodutch: result.components.goldenBorodutch + 1,
    todorant: result.components.todorant + 2,
    temply: result.components.temply + 3,
    jevAntispam: {
      bot: result.bots.jevAntispam,
      stats: result.projects.jevAntispam,
    },
  }
}

describe('daily collection publication', () => {
  test('publishes Jev and the headline total in one validated snapshot', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-daily-'))
    const outputPath = path.join(directory, 'latest.json')
    writeBaseline(outputPath)

    await collectAndPublish(
      outputPath,
      async () => collection(),
      () => new Date('2026-09-22T18:05:00.000Z')
    )

    const snapshot = readPublishedSnapshot(outputPath)
    expect(snapshot.schemaVersion).toBe(2)
    expect(snapshot.components.jevAntispam).toBe(230275)
    expect(snapshot.total).toBe(106917678)
    expect(snapshot.projects.jevAntispam.successfulDeletionCount).toBe(5337)
  })

  test('refreshes lightweight inputs while carrying historical bot scans forward', () => {
    const previous = baselineSnapshot()
    const result = dailyCollectionFromSnapshot(
      previous,
      liveInputs(),
      new Date('2026-09-22T18:00:00.000Z')
    )

    expect(result.components.speller).toBe(previous.components.speller)
    expect(result.bots.voicy).toEqual(previous.bots.voicy)
    expect(result.components.shieldy).toBe(previous.components.shieldy + 10)
    expect(result.components.jevAntispam).toBe(230275)
    expect(result.projects.jevAntispam.successfulDeletionCount).toBe(5337)
    expect(result.projects.jevAntispam.history).toEqual([{
      date: '2026-09-22',
      knownChatCount: 658,
      processedMessageCount: 43210,
      successfulDeletionCount: 5337,
    }])
    expect(result.generatedAt).toBe('2026-09-22T18:00:00.000Z')
  })

  test('starts Jev history with one honest point and replaces a same-day retry', () => {
    const stats = collection().projects.jevAntispam
    const first = historyWithJevStats(
      [],
      stats,
      new Date('2026-09-22T01:00:00.000Z')
    )
    const replacement = historyWithJevStats(
      first,
      { ...stats, processedMessageCount: 43211 },
      new Date('2026-09-22T23:00:00.000Z')
    )

    expect(first).toHaveLength(1)
    expect(replacement).toEqual([{
      date: '2026-09-22',
      knownChatCount: 658,
      processedMessageCount: 43211,
      successfulDeletionCount: 5337,
    }])
  })

  test('bounds a stalled daily source before publication', async () => {
    await expect(
      require('../../dist/helpers/dailyCollection').collectDailyStats(
        baselineSnapshot(),
        () => new Promise(function () {}),
        () => new Date('2026-09-22T18:00:00.000Z'),
        5
      )
    ).rejects.toThrow('Daily stats collection timed out')
  })

  test('preserves the last known good file when collection fails', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-daily-'))
    const outputPath = path.join(directory, 'latest.json')
    writeBaseline(outputPath)
    const previous = fs.readFileSync(outputPath, 'utf8')

    await expect(
      collectAndPublish(outputPath, async () => {
        throw new Error('Jev Telegram unavailable')
      })
    ).rejects.toThrow('Jev Telegram unavailable')

    expect(fs.readFileSync(outputPath, 'utf8')).toBe(previous)
    expect(fs.existsSync(outputPath + '.tmp')).toBe(false)
  })

  test('rejects an internally inconsistent Jev projection before writing', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-daily-'))
    const outputPath = path.join(directory, 'latest.json')
    writeBaseline(outputPath)
    const previous = fs.readFileSync(outputPath, 'utf8')
    const result = collection()
    result.projects.jevAntispam.combinedCommunityAudience -= 1

    await expect(
      collectAndPublish(outputPath, async () => result)
    ).rejects.toThrow('Jev community audience does not match')

    expect(fs.readFileSync(outputPath, 'utf8')).toBe(previous)
  })
})
