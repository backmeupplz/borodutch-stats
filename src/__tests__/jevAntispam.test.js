const { aggregateKnownChats } = require('../../dist/helpers/jevAntispam')

describe('Jev Antispam stats', () => {
  test('aggregates private chats, communities, and lifetime deletions', () => {
    const result = aggregateKnownChats([
      { chatId: '101', successfulDeletions: '2' },
      { chatId: '102', successfulDeletions: '0' },
      { chatId: '-100201', successfulDeletions: '5' },
    ])

    expect(Array.from(result.privateIds)).toEqual([101, 102])
    expect(Array.from(result.communityIds)).toEqual([-100201])
    expect(result.successfulDeletionCount).toBe(7)
  })

  test('rejects empty or malformed database results', () => {
    expect(() => aggregateKnownChats([])).toThrow('known_chats is empty')
    expect(() =>
      aggregateKnownChats([
        { chatId: '101', successfulDeletions: '-1' },
      ])
    ).toThrow('cannot be negative')
  })
})
