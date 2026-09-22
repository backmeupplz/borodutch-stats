const fs = require('fs')
const path = require('path')

function cleanupCheckpoints() {
  try {
    fs.rmSync(path.join(__dirname, '../../checkpoints'), {
      recursive: true,
      force: true,
    })
  } catch (e) {}
}

jest.mock('mongoose', () => {
  function cursorFor(documents) {
    let index = 0
    return {
      hasNext: jest.fn().mockImplementation(function () {
        return Promise.resolve(index < documents.length)
      }),
      next: jest.fn().mockImplementation(function () {
        return Promise.resolve(documents[index++])
      }),
      toArray: jest.fn().mockResolvedValue(documents),
      count: jest.fn().mockResolvedValue(documents.length),
    }
  }

  return {
    createConnection: jest
      .fn()
      .mockImplementation(function (uri, options) {
        const connection = {
          collection: jest.fn().mockImplementation(function (name) {
            return {
              find: jest.fn().mockImplementation(function (query, opts) {
                if (name === 'chats') {
                  return cursorFor([
                    { id: '123' },
                    { id: '124' },
                    { id: '-100456' },
                  ])
                }
                if (name === 'history') {
                  return cursorFor([
                    { chatId: '124' },
                    { chatId: '-100456' },
                    { chatId: '-100999' },
                  ])
                }
                if (name === 'failing') {
                  return cursorFor([{ chatId: '-100777' }])
                }
                if (name === 'users') {
                  const cursor = cursorFor([
                    { channels: ['-100789', '-100789'] },
                    { channels: [] },
                  ])
                  cursor.count = jest.fn().mockResolvedValue(2)
                  return cursor
                }
                return cursorFor([])
              }),
            }
          }),
          close: jest.fn().mockResolvedValue(undefined),
        }
        return {
          asPromise: jest.fn().mockResolvedValue(connection),
        }
      }),
  }
})

jest.mock('telegraf', () => {
  return function (token, options) {
    return {
      telegram: {
        getMe: jest.fn().mockResolvedValue({ id: 999 }),
        getChat: jest
          .fn()
          .mockImplementation(function (id) {
            if (id === 404) {
              const err = new Error('Not found')
              err.response = { error_code: 404 }
              throw err
            }
            return Promise.resolve({
              type: id > 0 ? 'private' : 'supergroup',
            })
          }),
        getChatMember: jest
          .fn()
          .mockImplementation(function (chatId, botId) {
            if (chatId === -100500) {
              const err = new Error('Group migrated')
              err.response = {
                error_code: 400,
                parameters: { migrate_to_chat_id: -100600 },
              }
              throw err
            }
            if (chatId === -100777) {
              const err = new Error('timeout')
              err.code = 'ETIMEDOUT'
              throw err
            }
            if (chatId === 403) {
              const err = new Error('Forbidden')
              err.response = { error_code: 403 }
              throw err
            }
            return Promise.resolve({ status: 'member' })
          }),
        getChatMembersCount: jest
          .fn()
          .mockImplementation(function (chatId) {
            return Promise.resolve(chatId === -100600 ? 321 : 100)
          }),
      },
    }
  }
})

const {
  getBotUsersFromChatIdsOptimized,
  getBotUsersOptimized,
  getBotUsersForSpellerOptimized,
  isRetryableError,
} = require('../../dist/helpers/optimizedGetBotUsers')

describe('isRetryableError', () => {
  test('identifies 429 as retryable', () => {
    const err = new Error('Too Many Requests')
    err.response = { error_code: 429, parameters: { retry_after: 5 } }
    expect(isRetryableError(err)).toBe(true)
  })

  test('identifies network errors as retryable', () => {
    const err1 = new Error('timeout')
    err1.code = 'ETIMEDOUT'
    expect(isRetryableError(err1)).toBe(true)

    const err2 = new Error('reset')
    err2.code = 'ECONNRESET'
    expect(isRetryableError(err2)).toBe(true)
  })

  test('identifies Telegram server errors as retryable', () => {
    const err = new Error('Bad Gateway')
    err.response = { error_code: 502 }
    expect(isRetryableError(err)).toBe(true)
  })

  test('does not identify 404 as retryable', () => {
    const err = new Error('Not found')
    err.response = { error_code: 404 }
    expect(isRetryableError(err)).toBe(false)
  })

  test('does not identify generic errors as retryable', () => {
    expect(isRetryableError(new Error('random'))).toBe(false)
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
  })
})

describe('getBotUsersOptimized', () => {
  beforeEach(cleanupCheckpoints)
  afterAll(cleanupCheckpoints)

  test('collects legacy count and reachability metrics', async () => {
    const result = await getBotUsersOptimized(
      'test-standard-bot',
      'mongodb://fake',
      'fake-token',
      'id',
      'chats',
      { concurrency: 5, ratePerSecond: 100 }
    )

    expect(typeof result.legacyUserCount).toBe('number')
    expect(result.reachability).toBeDefined()
    expect(result.reachability.reachableChatCount).toBeGreaterThanOrEqual(0)
  }, 30000)

  test('preserves legacy counting semantics', async () => {
    const result = await getBotUsersOptimized(
      'test-standard-bot',
      'mongodb://fake',
      'fake-token',
      'id',
      'chats',
      { concurrency: 5, ratePerSecond: 100 }
    )

    // 2 private chats * 1 + 1 group chat * 100 members = 102
    expect(result.legacyUserCount).toBe(102)
    expect(result.reachability.reachableChatCount).toBe(3)
    expect(result.reachability.reachablePrivateChatCount).toBe(2)
    expect(result.reachability.reachableGroupChatCount).toBe(1)
    expect(result.reachability.totalGroupAudienceEstimate).toBe(100)
    expect(result.reachability.unavailableGroupMemberCount).toBe(0)
  }, 30000)

  test('deduplicates IDs recovered from secondary collections', async () => {
    const result = await getBotUsersOptimized(
      'test-recovered-bot',
      'mongodb://fake',
      'fake-token',
      'id',
      'chats',
      {
        concurrency: 5,
        ratePerSecond: 100,
        additionalChatSources: [
          { collectionName: 'history', fieldNames: ['chatId'] },
        ],
      }
    )

    expect(result.inventory.privateIds).toBe(2)
    expect(result.inventory.groupIds).toBe(2)
    expect(result.inventory.sources[1]).toMatchObject({
      duplicateValues: 2,
      addedGroupIds: 1,
    })
    expect(result.legacyUserCount).toBe(202)
  }, 30000)

  test('fails closed when a Telegram call exhausts retries', async () => {
    await expect(
      getBotUsersOptimized(
        'test-failing-bot',
        'mongodb://fake',
        'fake-token',
        'chatId',
        'failing',
        {
          concurrency: 1,
          ratePerSecond: 100,
          maxRetries: 1,
          baseDelayMs: 1,
        }
      )
    ).rejects.toThrow('Telegram failures; checkpoint preserved for retry')
  }, 30000)
})

describe('getBotUsersFromChatIdsOptimized', () => {
  beforeEach(cleanupCheckpoints)
  afterAll(cleanupCheckpoints)

  test('refreshes and aggregates only the current database inventory', async () => {
    const first = await getBotUsersFromChatIdsOptimized(
      'current-inventory-bot',
      'fake-token',
      new Set([123]),
      new Set([-100456]),
      { concurrency: 5, ratePerSecond: 100, refreshAll: true }
    )
    const second = await getBotUsersFromChatIdsOptimized(
      'current-inventory-bot',
      'fake-token',
      new Set([124]),
      new Set([-100999]),
      { concurrency: 5, ratePerSecond: 100, refreshAll: true }
    )

    expect(first.legacyUserCount).toBe(101)
    expect(second.legacyUserCount).toBe(101)
    expect(second.inventory).toMatchObject({
      privateIds: 1,
      groupIds: 1,
      checkpointedGroups: 1,
    })
  })

  test('counts a migrated community under its canonical Telegram ID', async () => {
    const refreshed = await getBotUsersFromChatIdsOptimized(
      'migrated-community-bot',
      'fake-token',
      new Set(),
      new Set([-100500]),
      { concurrency: 5, ratePerSecond: 100, refreshAll: true }
    )
    const resumed = await getBotUsersFromChatIdsOptimized(
      'migrated-community-bot',
      'fake-token',
      new Set(),
      new Set([-100500]),
      { concurrency: 5, ratePerSecond: 100 }
    )
    const deduplicated = await getBotUsersFromChatIdsOptimized(
      'migrated-community-duplicate-bot',
      'fake-token',
      new Set(),
      new Set([-100500, -100600]),
      { concurrency: 5, ratePerSecond: 100, refreshAll: true }
    )

    for (const result of [refreshed, resumed, deduplicated]) {
      expect(result.legacyUserCount).toBe(321)
      expect(result.reachability).toMatchObject({
        reachableChatCount: 1,
        reachableGroupChatCount: 1,
        totalGroupAudienceEstimate: 321,
        unreachableChatCount: 0,
      })
    }
  })
})

describe('getBotUsersForSpellerOptimized', () => {
  beforeEach(cleanupCheckpoints)
  afterAll(cleanupCheckpoints)

  test('handles speller users + channels', async () => {
    const result = await getBotUsersForSpellerOptimized(
      'test-speller-bot',
      'mongodb://fake',
      'fake-token',
      { concurrency: 5, ratePerSecond: 100 }
    )

    expect(typeof result.legacyUserCount).toBe('number')
    expect(result.reachability).toBeDefined()
    // 2 users (from mock) + 1 channel with 100 members
    expect(result.legacyUserCount).toBe(102)
    expect(result.reachability.reachablePrivateChatCount).toBe(2)
    expect(result.reachability.reachableGroupChatCount).toBe(1)
    expect(result.reachability.totalGroupAudienceEstimate).toBe(100)
  }, 30000)
})
