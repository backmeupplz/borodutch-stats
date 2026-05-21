const {
  normalizeShieldyStats,
  shieldyUserCount,
} = require('../../dist/helpers/shieldy')

describe('Shieldy stats normalization', () => {
  test('keeps current source payload usable without shieldy.userCount', () => {
    const sourcePayload = {
      shieldy: {
        chatDaily: [
          { _id: null, count: 1 },
          { _id: 2751, count: 100 },
        ],
        chatCount: 779204,
      },
    }

    const normalized = normalizeShieldyStats(sourcePayload)

    expect(normalized.chatCount).toBe(779204)
    expect(normalized.chatDaily).toEqual([
      { _id: 2751, count: 100 },
      { _id: null, count: 1 },
    ])
    expect(normalized.userCount).toBe(779204)
    expect(normalized.userCountSource).toBe('chatCount')
    expect(shieldyUserCount(normalized)).toBe(779204)
  })

  test('prefers explicit userCount when the source provides it', () => {
    const normalized = normalizeShieldyStats({
      shieldy: {
        userCount: 123,
        chatCount: 456,
        chatDaily: [{ _id: 1, count: 789 }],
      },
    })

    expect(normalized.userCount).toBe(123)
    expect(normalized.userCountSource).toBe('userCount')
  })

  test('keeps explicit zero userCount as valid evidence', () => {
    const normalized = normalizeShieldyStats({
      shieldy: {
        userCount: 0,
        chatCount: 456,
        chatDaily: [{ _id: 1, count: 789 }],
      },
    })

    expect(normalized.userCount).toBe(0)
    expect(normalized.userCountSource).toBe('userCount')
    expect(shieldyUserCount(normalized)).toBe(0)
  })
})
