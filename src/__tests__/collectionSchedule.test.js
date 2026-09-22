const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { collectionDelay, maximumTimerDelayMs, withCollectionLock } = require('../../dist/helpers/collectionSchedule')

const published = '2026-09-22T22:58:25.173Z'
test('persisted successful timestamp skips restart and becomes due after 24h', () => {
  expect(collectionDelay(published, Date.parse('2026-09-22T23:00:00Z'))).toBe(86305173)
  expect(collectionDelay(published, Date.parse('2026-09-23T22:58:25.173Z'))).toBe(0)
  expect(collectionDelay(published, Date.parse('2026-09-24T00:00:00Z'))).toBe(0)
  expect(() => collectionDelay('broken', Date.now())).toThrow()
  expect(() => collectionDelay('2026-02-30T00:00:00.000Z')).toThrow()
  expect(() => collectionDelay('2026-09-22T22:58:25Z')).toThrow()
})

test('SIGKILL holder releases lock without unlink; restart runs one due collection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-killed-lock-'))
  const lock = path.join(dir, 'latest.json.collection.lock')
  const holder = spawn(process.execPath, ['-e', `
    require(${JSON.stringify(path.resolve(__dirname, '../../dist/helpers/collectionSchedule'))})
      .withCollectionLock(${JSON.stringify(lock)}, () => {
        console.log('HELD')
        return new Promise(() => {})
      }).catch(error => { console.error(error); process.exit(1) })
  `], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await new Promise((resolve, reject) => {
      holder.stdout.on('data', data => { if (data.toString().includes('HELD')) resolve() })
      holder.on('error', reject)
      holder.on('exit', code => reject(new Error('Holder exited before acquiring: ' + code)))
    })
    const duplicate = jest.fn()
    await expect(withCollectionLock(lock, duplicate)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(duplicate).not.toHaveBeenCalled()
    // The live API/manual entrypoint must also refuse a second collector.
    // Simulate restarted API/manual due-collection entrypoint on the same path.
    process.env.STATS_USER_COUNT_HISTORY_PATH = path.join(dir, 'history.txt')
    process.env.STATS_PUBLISHED_RESULT_PATH = path.join(dir, 'latest.json')
    jest.resetModules()
    jest.dontMock('../../dist/helpers/collectionSchedule')
    const current = { publishedAt: '2026-09-20T00:00:00.000Z', generatedAt: published, total: 105896970, components: {}, bots: {} }
    jest.doMock('../../dist/helpers/publishedSnapshot', () => ({
      installPublishedSeed: jest.fn(),
      readPublishedSnapshot: () => current,
      publishedSnapshotMtime: () => 1,
      historyWithSnapshot: () => [],
      aggregateReachability: () => ({}),
    }))
    const collect = jest.fn(async () => {
      current.publishedAt = new Date().toISOString()
      return current
    })
    jest.doMock('../../dist/helpers/dailyCollection', () => ({ collectAndPublish: collect }))
    const { runCollection } = require('../../dist/helpers/userCount')
    await expect(runCollection()).rejects.toMatchObject({ code: 'EEXIST' })
    expect(collect).not.toHaveBeenCalled()
    holder.kill('SIGKILL')
    await new Promise(resolve => holder.once('exit', resolve))
    // The lock's child observes the dead parent's closed pipe and exits.
    for (let attempt = 0; attempt < 30 && collect.mock.calls.length === 0; attempt++) {
      try {
        await runCollection()
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    expect(collect).toHaveBeenCalledTimes(1)
    await runCollection()
    expect(collect).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(lock)).toBe(true)
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL')
    delete process.env.STATS_USER_COUNT_HISTORY_PATH
    delete process.env.STATS_PUBLISHED_RESULT_PATH
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file))
    fs.rmdirSync(dir)
  }
})

test('exclusive lock prevents concurrent publishers and releases after failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-lock-'))
  const lock = path.join(dir, 'collection.lock')
  let release, ready
  const started = new Promise(resolve => { ready = resolve })
  const running = withCollectionLock(lock, () => {
    ready()
    return new Promise(resolve => { release = resolve })
  })
  await started
  const duplicate = jest.fn()
  await expect(withCollectionLock(lock, duplicate)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(duplicate).not.toHaveBeenCalled()
  release()
  await running
  await expect(withCollectionLock(lock, async () => { throw new Error('source failure') })).rejects.toThrow('source failure')
  expect(fs.existsSync(lock)).toBe(true)
  await expect(withCollectionLock(lock, async () => 42)).resolves.toBe(42)
  fs.unlinkSync(lock)
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
    // Timer tests use a synchronous no-op lock; real subprocess locks have their
    // own process/crash test below and cannot run inside Jest's fake timers.
    jest.doMock('../../dist/helpers/collectionSchedule', () => ({
      ...jest.requireActual('../../dist/helpers/collectionSchedule'),
      withCollectionLock: (_path, callback) => callback(),
    }))
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
  test('future publication waits through real timer path, without overflow loop or early count', async () => {
    current.publishedAt = '2026-10-30T00:00:00.000Z'
    userCount.startDailyCollection()
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersToNextTimer(1)
    await settle()
    expect(Date.now()).toBe(Date.parse('2026-09-22T23:00:00Z') + maximumTimerDelayMs)
    expect(collect).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersToNextTimer(1)
    await settle()
    expect(Date.now()).toBe(Date.parse('2026-10-31T00:00:00.000Z'))
    expect(collect).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
  })
  test('invalid calendar date retains last good and retries instead of collecting', async () => {
    current.publishedAt = '2026-02-30T00:00:00.000Z'
    const previous = { ...current }
    userCount.startDailyCollection()
    jest.advanceTimersByTime(60000)
    await settle()
    expect(collect).not.toHaveBeenCalled()
    expect(current).toEqual(previous)
    expect(jest.getTimerCount()).toBe(1)
  })
  test('failed due count retains last-good snapshot and retries after one hour', async () => {
    current.publishedAt = '2026-09-20T00:00:00.000Z'
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
