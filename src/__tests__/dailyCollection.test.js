const fs = require('fs')
const os = require('os')
const path = require('path')
const { collectAndPublish } = require('../../dist/helpers/dailyCollection')
const { readPublishedSnapshot } = require('../../dist/helpers/publishedSnapshot')

function metrics(privateChats = 1, communities = 0, audience = 0) {
  return {
    reachableChatCount: privateChats + communities,
    reachablePrivateChatCount: privateChats,
    reachableGroupChatCount: communities,
    reachableChannelCount: 0,
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
    reachability: metrics(504, 123, 229771),
    inventory: {
      privateIds: 504,
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
        knownChatCount: 654,
        privateChatCount: 504,
        reachableCommunityCount: 123,
        combinedCommunityAudience: 229771,
        successfulDeletionCount: 5337,
      },
    },
  }
}

describe('daily collection publication', () => {
  test('publishes Jev and the headline total in one validated snapshot', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-daily-'))
    const outputPath = path.join(directory, 'latest.json')

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

  test('preserves the last known good file when collection fails', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-daily-'))
    const outputPath = path.join(directory, 'latest.json')
    const previous = '{"lastKnownGood":true}\n'
    fs.writeFileSync(outputPath, previous)

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
    const previous = '{"lastKnownGood":true}\n'
    fs.writeFileSync(outputPath, previous)
    const result = collection()
    result.projects.jevAntispam.combinedCommunityAudience -= 1

    await expect(
      collectAndPublish(outputPath, async () => result)
    ).rejects.toThrow('Jev community audience does not match')

    expect(fs.readFileSync(outputPath, 'utf8')).toBe(previous)
  })
})
