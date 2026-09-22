const fs = require('fs')
const os = require('os')
const path = require('path')
const { collectionDelay, withCollectionLock } = require('../../dist/helpers/collectionSchedule')

const published = '2026-09-22T22:58:25.173Z'
test('persisted successful timestamp skips restart and becomes due after 24h', () => {
  expect(collectionDelay(published, Date.parse('2026-09-22T23:00:00Z'))).toBe(86305173)
  expect(collectionDelay(published, Date.parse('2026-09-23T22:58:25.173Z'))).toBe(0)
  expect(collectionDelay(published, Date.parse('2026-09-24T00:00:00Z'))).toBe(0)
  expect(() => collectionDelay('broken', Date.now())).toThrow()
})

test('exclusive lock prevents concurrent publishers and releases after failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-lock-'))
  const lock = path.join(dir, 'collection.lock')
  let release
  const running = withCollectionLock(lock, () => new Promise(resolve => { release = resolve }))
  const duplicate = jest.fn()
  await expect(withCollectionLock(lock, duplicate)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(duplicate).not.toHaveBeenCalled()
  release()
  await running
  await expect(withCollectionLock(lock, async () => { throw new Error('source failure') })).rejects.toThrow('source failure')
  expect(fs.existsSync(lock)).toBe(false)
  await expect(withCollectionLock(lock, async () => 42)).resolves.toBe(42)
  fs.rmdirSync(dir)
})

describe('production entrypoint controlled-clock scheduling', () => {
  let dir, current, userCount, collect
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers('modern')
    jest.setSystemTime(new Date('2026-09-22T23:00:00Z'))
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-scheduler-'))
    process.env.STATS_USER_COUNT_HISTORY_PATH = path.join(dir, 'usercount.txt')
    process.env.STATS_PUBLISHED_RESULT_PATH = path.join(dir, 'latest.json')
    current = { publishedAt: published, generatedAt: published, total: 105896970, components: {}, bots: {} }
    jest.doMock('../../dist/helpers/publishedSnapshot', () => ({
      installPublishedSeed: jest.fn(),
      readPublishedSnapshot: () => current,
      publishedSnapshotMtime: () => 1,
      historyWithSnapshot: () => [],
      aggregateReachability: () => ({}),
    }))
    collect = jest.fn(async () => {
      current = { ...current, publishedAt: new Date().toISOString(), generatedAt: new Date().toISOString() }
      return current
    })
    jest.doMock('../../dist/helpers/dailyCollection', () => ({ collectAndPublish: collect }))
    userCount = require('../../dist/helpers/userCount')
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete process.env.STATS_USER_COUNT_HISTORY_PATH
    delete process.env.STATS_PUBLISHED_RESULT_PATH
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file))
    fs.rmdirSync(dir)
  })
  async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve() }
  test('startup and manual calls skip a fresh snapshot; next day collects exactly once', async () => {
    userCount.startDailyCollection()
    userCount.startDailyCollection()
    await userCount.runCollection()
    jest.advanceTimersByTime(60000)
    await settle()
    expect(collect).not.toHaveBeenCalled()
    jest.advanceTimersByTime(86305173 - 60000)
    await settle()
    expect(collect).toHaveBeenCalledTimes(1)
    await userCount.runCollection()
    expect(collect).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
  })
  test('failed due count retains last-good snapshot and retries after one hour', async () => {
    current.publishedAt = '2026-09-20T00:00:00Z'
    const previous = { ...current }
    collect.mockRejectedValueOnce(new Error('source unavailable'))
    userCount.startDailyCollection()
    jest.advanceTimersByTime(60000)
    await settle()
    expect(collect).toHaveBeenCalledTimes(1)
    expect(current).toEqual(previous)
    jest.advanceTimersByTime(3599999)
    await settle()
    expect(collect).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    await settle()
    expect(collect).toHaveBeenCalledTimes(2)
  })
})
