const mockStats = {}

jest.mock('../../dist/helpers/stats', () => ({
  stats: mockStats,
}))

const { deriveProjectCounts, summary } = require('../../dist/helpers/summary')

function resetStats(value) {
  for (const key of Object.keys(mockStats)) {
    delete mockStats[key]
  }
  Object.assign(mockStats, value)
}

describe('summary stats', () => {
  beforeEach(() => {
    resetStats({})
  })

  test('derives lightweight project counts when cached per-project counts are empty', () => {
    resetStats({
      shieldy: {
        chatDaily: [{ _id: 1, count: 2 }],
        chatCount: 780587,
        userCount: 60472766,
      },
      voicy: {
        stats: {
          chatCount: 4104363,
          messageStats: [{ date: '2026-05-27', count: 10 }],
        },
      },
      banofbot: {
        userCount: 200000,
        chatCount: 326449,
        requestDaily: [{ _id: 1, count: 2 }],
      },
      temply: {
        userCount: 12046,
        userDaily: [{ _id: 1, count: 2 }],
      },
      userCount: {
        count: 110924319,
        history: [['1776176459819', '110924319']],
      },
      userCountSeparate: {},
    })

    const data = summary()

    expect(data.projectCounts.shieldy).toEqual({
      count: 60472766,
      label: 'users',
      source: 'shieldy.userCount',
    })
    expect(data.projectCounts.voicy).toEqual({
      count: 4104363,
      label: 'chats',
      source: 'voicy.stats.chatCount',
    })
    expect(data.projectCounts.banofbot).toEqual({
      count: 200000,
      label: 'users',
      source: 'banofbot.userCount',
    })
    expect(data.projectCounts.temply).toEqual({
      count: 12046,
      label: 'users',
      source: 'temply.userCount',
    })
    expect(data.userCountSeparate).toEqual({
      shieldy: 60472766,
      banofbot: 200000,
      temply: 12046,
    })
    expect(data.shieldy.chatDaily).toBeUndefined()
    expect(data.userCount.history).toBeUndefined()
  })

  test('prefers a positive cached user count over scalar summary fallbacks', () => {
    resetStats({
      voicy: {
        stats: {
          chatCount: 4104363,
        },
      },
      userCountSeparate: {
        voicy: 987654,
      },
    })

    expect(deriveProjectCounts(mockStats).voicy).toEqual({
      count: 987654,
      label: 'users',
      source: 'userCountSeparate',
    })
    expect(summary().userCountSeparate).toEqual({
      voicy: 987654,
    })
  })
})
