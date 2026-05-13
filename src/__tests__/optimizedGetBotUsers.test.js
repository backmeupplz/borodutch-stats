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
  return {
    createConnection: jest
      .fn()
      .mockImplementation(function (uri, options) {
        return Promise.resolve({
          collection: jest.fn().mockImplementation(function (name) {
            return {
              find: jest.fn().mockImplementation(function (query, opts) {
                return {
                  toArray: jest
                    .fn()
                    .mockImplementation(function () {
                      if (name === 'chats') {
                        return Promise.resolve([
                          { id: '123' },
                          { id: '124' },
                          { id: '-100456' },
                        ])
                      }
                      if (name === 'users') {
                        return Promise.resolve([
                          { channels: ['-100789'] },
                          { channels: [] },
                        ])
                      }
                      return Promise.resolve([])
                    }),
                  count: jest.fn().mockImplementation(function () {
                    if (name === 'users') return Promise.resolve(2)
                    return Promise.resolve(0)
                  }),
                }
              }),
            }
          }),
          close: jest.fn().mockResolvedValue(undefined),
        })
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
            if (chatId === 403) {
              const err = new Error('Forbidden')
              err.response = { error_code: 403 }
              throw err
            }
            return Promise.resolve({ status: 'member' })
          }),
        getChatMembersCount: jest.fn().mockResolvedValue(100),
      },
    }
  }
})

const {
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
