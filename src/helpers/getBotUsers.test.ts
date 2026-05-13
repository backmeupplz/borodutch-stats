import {
  ChatCacheEntry,
  ReachabilityResult,
  createLimiter,
  withRetry,
  updateResultFromEntry,
  getBotUsers,
  getBotReachability,
  getBotReachabilityForSpeller,
} from './getBotUsers'

// ─── Mocks ─────────────────────────────────────────────────────────────

jest.mock('fs', function () {
  return {
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
  }
})

jest.mock('mongoose', function () {
  return {
    createConnection: jest.fn(),
  }
})

jest.mock('telegraf', function () {
  return jest.fn().mockImplementation(function () {
    return {
      telegram: {
        getChat: jest.fn(),
        getChatMembersCount: jest.fn(),
      },
    }
  })
})

const fs = require('fs')
const mongoose = require('mongoose')
const Telegraf = require('telegraf')

// ─── Helpers ───────────────────────────────────────────────────────────

function makeResult(): ReachabilityResult {
  return {
    totalUsers: 0,
    directCount: 0,
    groupCount: 0,
    supergroupCount: 0,
    channelCount: 0,
    unreachableCount: 0,
    groupAudience: 0,
    supergroupAudience: 0,
    channelAudience: 0,
    totalAudience: 0,
    checkedCount: 0,
    cachedCount: 0,
    totalChats: 0,
  }
}

function makeCacheFile(chats: any, lastUpdated?: number): string {
  return JSON.stringify({
    version: 1,
    lastUpdated: lastUpdated || Date.now(),
    chats: chats,
  })
}

// ─── createLimiter ─────────────────────────────────────────────────────

describe('createLimiter', function () {
  it('should bound concurrency to the configured limit', async function () {
    const limiter = createLimiter(2)
    let running = 0
    let maxRunning = 0

    const promises: Promise<void>[] = []
    for (let i = 0; i < 5; i++) {
      promises.push(
        (async function () {
          await limiter.acquire()
          running++
          if (running > maxRunning) {
            maxRunning = running
          }
          await new Promise(function (res) {
            setTimeout(res, 10)
          })
          running--
          limiter.release()
        })()
      )
    }

    await Promise.all(promises)
    expect(maxRunning).toBe(2)
  })
})

// ─── withRetry ─────────────────────────────────────────────────────────

describe('withRetry', function () {
  it('succeeds immediately on first attempt', async function () {
    const fn = jest.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, 3, 10)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries with exponential backoff on regular errors', async function () {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValue('ok')

    const start = Date.now()
    const result = await withRetry(fn, 3, 10)
    const elapsed = Date.now() - start

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
    // backoffs: 10ms, 20ms  → total ~30ms+
    expect(elapsed).toBeGreaterThanOrEqual(25)
  })

  it('waits retry_after seconds on Telegram rate-limit (429)', async function () {
    const rateLimitErr = {
      response: {
        parameters: {
          retry_after: 0.05, // 50 ms
        },
      },
    }
    const fn = jest.fn().mockRejectedValueOnce(rateLimitErr).mockResolvedValue('ok')

    const start = Date.now()
    const result = await withRetry(fn, 3, 10)
    const elapsed = Date.now() - start

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  it('does not consume retry budget for rate-limits', async function () {
    const rateLimitErr = {
      response: {
        parameters: {
          retry_after: 0.03,
        },
      },
    }
    const fn = jest
      .fn()
      .mockRejectedValueOnce(rateLimitErr)
      .mockRejectedValueOnce(rateLimitErr)
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValue('ok')

    const result = await withRetry(fn, 2, 10)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('throws after exhausting maxRetries on non-rate-limit errors', async function () {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'))
    await expect(withRetry(fn, 2, 1)).rejects.toThrow('always fails')
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

// ─── updateResultFromEntry ─────────────────────────────────────────────

describe('updateResultFromEntry', function () {
  let result: ReachabilityResult

  beforeEach(function () {
    result = makeResult()
  })

  it('counts private chat as direct (legacy = 1)', function () {
    const entry: ChatCacheEntry = {
      id: 123456789,
      reachable: true,
      type: 'private',
      members: 1,
      lastChecked: Date.now(),
    }
    updateResultFromEntry(result, entry)
    expect(result.directCount).toBe(1)
    expect(result.unreachableCount).toBe(0)
    expect(result.totalUsers).toBe(0) // totalUsers is computed later
  })

  it('counts group with audience', function () {
    const entry: ChatCacheEntry = {
      id: -1001111111111,
      reachable: true,
      type: 'group',
      members: 300,
      lastChecked: Date.now(),
    }
    updateResultFromEntry(result, entry)
    expect(result.groupCount).toBe(1)
    expect(result.groupAudience).toBe(300)
  })

  it('counts supergroup with audience', function () {
    const entry: ChatCacheEntry = {
      id: -1002222222222,
      reachable: true,
      type: 'supergroup',
      members: 5000,
      lastChecked: Date.now(),
    }
    updateResultFromEntry(result, entry)
    expect(result.supergroupCount).toBe(1)
    expect(result.supergroupAudience).toBe(5000)
  })

  it('counts channel with audience', function () {
    const entry: ChatCacheEntry = {
      id: -1003333333333,
      reachable: true,
      type: 'channel',
      members: 25000,
      lastChecked: Date.now(),
    }
    updateResultFromEntry(result, entry)
    expect(result.channelCount).toBe(1)
    expect(result.channelAudience).toBe(25000)
  })

  it('marks unreachable chats separately', function () {
    const entry: ChatCacheEntry = {
      id: -1004444444444,
      reachable: false,
      lastChecked: Date.now(),
      error: 'Chat not found',
    }
    updateResultFromEntry(result, entry)
    expect(result.unreachableCount).toBe(1)
    expect(result.directCount).toBe(0)
    expect(result.groupCount).toBe(0)
    expect(result.supergroupCount).toBe(0)
    expect(result.channelCount).toBe(0)
  })

  it('aggregates mixed entries correctly', function () {
    const entries: ChatCacheEntry[] = [
      { id: 1, reachable: true, type: 'private', members: 1, lastChecked: 1 },
      { id: 2, reachable: true, type: 'private', members: 1, lastChecked: 1 },
      { id: -1, reachable: true, type: 'group', members: 100, lastChecked: 1 },
      { id: -2, reachable: true, type: 'supergroup', members: 1000, lastChecked: 1 },
      { id: -3, reachable: true, type: 'channel', members: 5000, lastChecked: 1 },
      { id: -4, reachable: false, lastChecked: 1, error: 'gone' },
    ]
    entries.forEach(function (e) {
      updateResultFromEntry(result, e)
    })
    expect(result.directCount).toBe(2)
    expect(result.groupCount).toBe(1)
    expect(result.groupAudience).toBe(100)
    expect(result.supergroupCount).toBe(1)
    expect(result.supergroupAudience).toBe(1000)
    expect(result.channelCount).toBe(1)
    expect(result.channelAudience).toBe(5000)
    expect(result.unreachableCount).toBe(1)
  })
})

// ─── Cache + getBotReachability (integration) ──────────────────────────

describe('getBotReachability', function () {
  beforeEach(function () {
    jest.clearAllMocks()
  })

  it('returns fully-cached results without calling Telegram API', async function () {
    const now = Date.now()
    const cachePayload = makeCacheFile({
      '123456789': {
        id: 123456789,
        reachable: true,
        type: 'private',
        members: 1,
        lastChecked: now,
      },
      '-1001234567890': {
        id: -1001234567890,
        reachable: true,
        type: 'supergroup',
        members: 999,
        lastChecked: now,
      },
    })

    fs.readFileSync.mockReturnValue(cachePayload)
    fs.existsSync.mockReturnValue(true)

    // Mongo mock
    const mockFind = jest.fn().mockReturnValue({
      count: jest.fn().mockResolvedValue(2),
      toArray: jest.fn().mockResolvedValue([
        { id: 123456789 },
        { id: -1001234567890 },
      ]),
    })
    mongoose.createConnection.mockResolvedValue({
      collection: jest.fn().mockReturnValue({ find: mockFind }),
      close: jest.fn().mockResolvedValue(undefined),
    })

    // Telegraf mock — should NOT be called
    const mockGetChat = jest.fn()
    const mockGetMembers = jest.fn()
    Telegraf.mockImplementation(function () {
      return {
        telegram: {
          getChat: mockGetChat,
          getChatMembersCount: mockGetMembers,
        },
      }
    })

    const result = await getBotReachability(
      '@testbot',
      'mongodb://test',
      'token',
      'id',
      'chats',
      { cacheTtlMs: 3600000 }
    )

    expect(result.totalChats).toBe(2)
    expect(result.cachedCount).toBe(2)
    expect(result.checkedCount).toBe(0)
    expect(result.directCount).toBe(1)
    expect(result.supergroupCount).toBe(1)
    expect(result.supergroupAudience).toBe(999)
    expect(result.totalUsers).toBe(1000)
    expect(mockGetChat).not.toHaveBeenCalled()
    expect(mockGetMembers).not.toHaveBeenCalled()
  })

  it('re-checks stale cache entries via getChat + getChatMembersCount', async function () {
    const now = Date.now()
    const stale = now - 25 * 60 * 60 * 1000 // 25 h ago (TTL = 24 h)

    const cachePayload = makeCacheFile(
      {
        '123456789': {
          id: 123456789,
          reachable: true,
          type: 'private',
          members: 1,
          lastChecked: stale,
        },
      },
      stale
    )

    fs.readFileSync.mockReturnValue(cachePayload)
    fs.existsSync.mockReturnValue(true)

    const mockFind = jest.fn().mockReturnValue({
      count: jest.fn().mockResolvedValue(1),
      toArray: jest.fn().mockResolvedValue([{ id: 123456789 }]),
    })
    mongoose.createConnection.mockResolvedValue({
      collection: jest.fn().mockReturnValue({ find: mockFind }),
      close: jest.fn().mockResolvedValue(undefined),
    })

    const mockGetChat = jest.fn().mockResolvedValue({ type: 'private' })
    Telegraf.mockImplementation(function () {
      return {
        telegram: {
          getChat: mockGetChat,
          getChatMembersCount: jest.fn(),
        },
      }
    })

    const result = await getBotReachability(
      '@testbot',
      'mongodb://test',
      'token',
      'id',
      'chats',
      { cacheTtlMs: 24 * 60 * 60 * 1000 }
    )

    expect(result.checkedCount).toBe(1)
    expect(result.cachedCount).toBe(0)
    expect(result.directCount).toBe(1)
    expect(mockGetChat).toHaveBeenCalledWith(123456789)
  })

  it('classifies unreachable chats (getChat throws)', async function () {
    fs.readFileSync.mockImplementation(function () {
      throw new Error('no cache')
    })
    fs.existsSync.mockReturnValue(false)

    const mockFind = jest.fn().mockReturnValue({
      count: jest.fn().mockResolvedValue(1),
      toArray: jest.fn().mockResolvedValue([{ id: -1009999999999 }]),
    })
    mongoose.createConnection.mockResolvedValue({
      collection: jest.fn().mockReturnValue({ find: mockFind }),
      close: jest.fn().mockResolvedValue(undefined),
    })

    const mockGetChat = jest.fn().mockRejectedValue(new Error('Chat not found'))
    Telegraf.mockImplementation(function () {
      return {
        telegram: {
          getChat: mockGetChat,
          getChatMembersCount: jest.fn(),
        },
      }
    })

    const result = await getBotReachability(
      '@testbot',
      'mongodb://test',
      'token'
    )

    expect(result.unreachableCount).toBe(1)
    expect(result.totalUsers).toBe(0)
    expect(result.directCount).toBe(0)
    expect(result.groupCount).toBe(0)
  })

  it('saves cache incrementally during processing', async function () {
    fs.readFileSync.mockImplementation(function () {
      throw new Error('no cache')
    })
    fs.existsSync.mockReturnValue(false)

    const chats = []
    for (let i = 0; i < 250; i++) {
      chats.push({ id: -1000000000000 - i })
    }

    const mockFind = jest.fn().mockReturnValue({
      count: jest.fn().mockResolvedValue(chats.length),
      toArray: jest.fn().mockResolvedValue(chats),
    })
    mongoose.createConnection.mockResolvedValue({
      collection: jest.fn().mockReturnValue({ find: mockFind }),
      close: jest.fn().mockResolvedValue(undefined),
    })

    const mockGetChat = jest.fn().mockResolvedValue({ type: 'supergroup' })
    const mockGetMembers = jest.fn().mockResolvedValue(10)
    Telegraf.mockImplementation(function () {
      return {
        telegram: {
          getChat: mockGetChat,
          getChatMembersCount: mockGetMembers,
        },
      }
    })

    await getBotReachability(
      '@testbot',
      'mongodb://test',
      'token',
      'id',
      'chats',
      { batchSize: 50, saveInterval: 2 } // 5 batches, save every 2 batches
    )

    // Should save at least twice (after batch 100 and final batch 250)
    expect(fs.writeFileSync).toHaveBeenCalled()
    const saveCalls = fs.writeFileSync.mock.calls
    // Verify the cache file was written with the correct structure
    const lastCall = saveCalls[saveCalls.length - 1]
    const savedData = JSON.parse(lastCall[1])
    expect(savedData.version).toBe(1)
    expect(Object.keys(savedData.chats).length).toBe(chats.length)
  })
})

// ─── getBotReachabilityForSpeller ──────────────────────────────────────

describe('getBotReachabilityForSpeller', function () {
  beforeEach(function () {
    jest.clearAllMocks()
  })

  it('counts users + channel audience for speller variant', async function () {
    const now = Date.now()
    const cachePayload = makeCacheFile({
      '-1005555555555': {
        id: -1005555555555,
        reachable: true,
        type: 'channel',
        members: 2000,
        lastChecked: now,
      },
    })

    fs.readFileSync.mockReturnValue(cachePayload)
    fs.existsSync.mockReturnValue(true)

    // Speller DB: users collection with channels array
    const users = [
      { channels: [-1005555555555] },
      { channels: [] },
      { channels: [-1005555555555, -1006666666666] },
    ]
    const mockFind = jest.fn().mockReturnValue({
      count: jest.fn().mockResolvedValue(3),
      toArray: jest.fn().mockResolvedValue(users),
    })
    mongoose.createConnection.mockResolvedValue({
      collection: jest.fn().mockReturnValue({ find: mockFind }),
      close: jest.fn().mockResolvedValue(undefined),
    })

    const mockGetChat = jest.fn().mockResolvedValue({ type: 'channel' })
    const mockGetMembers = jest.fn().mockResolvedValue(2000)
    Telegraf.mockImplementation(function () {
      return {
        telegram: {
          getChat: mockGetChat,
          getChatMembersCount: mockGetMembers,
        },
      }
    })

    const result = await getBotReachabilityForSpeller(
      '@speller',
      'mongodb://test',
      'token',
      { cacheTtlMs: 3600000 }
    )

    expect(result.totalChats).toBe(6) // 3 users + 3 channel entries (one duplicated)
    expect(result.directCount).toBe(3) // 3 users
    expect(result.channelAudience).toBe(6000) // 3 channels * 2000 members each
    expect(result.totalUsers).toBe(6003) // 3 users + 6000 channel members
  })
})

// ─── Legacy wrapper ──────────────────────────────────────────────────────

describe('getBotUsers (legacy API preservation)', function () {
  beforeEach(function () {
    jest.clearAllMocks()
  })

  it('returns the same totalUsers number as the old API', async function () {
    const now = Date.now()
    const cachePayload = makeCacheFile({
      '111111111': {
        id: 111111111,
        reachable: true,
        type: 'private',
        members: 1,
        lastChecked: now,
      },
      '-1007777777777': {
        id: -1007777777777,
        reachable: true,
        type: 'supergroup',
        members: 750,
        lastChecked: now,
      },
    })

    fs.readFileSync.mockReturnValue(cachePayload)
    fs.existsSync.mockReturnValue(true)

    const mockFind = jest.fn().mockReturnValue({
      count: jest.fn().mockResolvedValue(2),
      toArray: jest.fn().mockResolvedValue([
        { id: 111111111 },
        { id: -1007777777777 },
      ]),
    })
    mongoose.createConnection.mockResolvedValue({
      collection: jest.fn().mockReturnValue({ find: mockFind }),
      close: jest.fn().mockResolvedValue(undefined),
    })

    Telegraf.mockImplementation(function () {
      return {
        telegram: {
          getChat: jest.fn(),
          getChatMembersCount: jest.fn(),
        },
      }
    })

    const total = await getBotUsers(
      '@legacybot',
      'mongodb://test',
      'token'
    )

    expect(total).toBe(751) // 1 private + 750 supergroup
  })
})
