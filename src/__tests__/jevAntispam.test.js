const { aggregateKnownChats } = require('../../dist/helpers/jevAntispam')

describe('Jev Antispam stats', () => {
  test('keeps every raw chat row in the total and aggregates privacy-safe counters', () => {
    const result = aggregateKnownChats([
      {
        chatId: '101',
        successfulDeletions: '2', processedMessages: '0',
      },
      {
        chatId: '102',
        successfulDeletions: '0', processedMessages: '0',
      },
      {
        chatId: '-100201',
        successfulDeletions: '5', processedMessages: '11',
      },
      {
        chatId: '-100202',
        successfulDeletions: '1', processedMessages: '0',
      },
      {
        chatId: '-100203',
        successfulDeletions: '0', processedMessages: '0',
      },
    ])

    expect(Array.from(result.privateIds)).toEqual([101, 102])
    expect(Array.from(result.communityIds)).toEqual([-100201, -100202, -100203])
    expect(result.privateIds.size + result.communityIds.size).toBe(5)
    expect(result.successfulDeletionCount).toBe(8)
    expect(result.processedMessageCount).toBe(11)
  })

  test('rejects empty or malformed database results', () => {
    expect(() => aggregateKnownChats([])).toThrow('known_chats is empty')
    expect(() =>
      aggregateKnownChats([
        {
          chatId: '101',
          successfulDeletions: '-1', processedMessages: '0',
        },
      ])
    ).toThrow('cannot be negative')
  })

  test('reports the current 658 raw rows without filtering legacy or channel IDs', () => {
    const rows = []
    for (let id = 1; id <= 508; id++) {
      rows.push({
        chatId: String(id),
        successfulDeletions: '0',
        processedMessages: '0',
      })
    }
    for (let id = 1; id <= 150; id++) {
      rows.push({
        chatId: String(-100000 - id),
        successfulDeletions: '0',
        processedMessages: '0',
      })
    }

    const result = aggregateKnownChats(rows)
    expect(result.privateIds.size).toBe(508)
    expect(result.communityIds.size).toBe(150)
    expect(result.privateIds.size + result.communityIds.size).toBe(658)
  })
})
