const { TelegramPool } = require('../../dist/helpers/telegramPool')

describe('TelegramPool', () => {
  test('limits concurrency', async () => {
    const pool = new TelegramPool({
      concurrency: 2,
      ratePerSecond: 1000,
      maxRetries: 3,
    })
    let running = 0
    let maxRunning = 0

    const tasks = []
    for (let i = 0; i < 10; i++) {
      tasks.push(
        pool.execute(async function () {
          running++
          if (running > maxRunning) {
            maxRunning = running
          }
          await new Promise(function (resolve) {
            setTimeout(resolve, 50)
          })
          running--
          return 'done'
        })
      )
    }

    await Promise.all(tasks)
    expect(maxRunning).toBeLessThanOrEqual(2)
    pool.destroy()
  })

  test('rate limits task starts', async () => {
    const pool = new TelegramPool({
      concurrency: 10,
      ratePerSecond: 10,
      maxRetries: 3,
    })
    const starts = []

    const tasks = []
    for (let i = 0; i < 5; i++) {
      tasks.push(
        pool.execute(async function () {
          starts.push(Date.now())
          return 'done'
        })
      )
    }

    await Promise.all(tasks)
    expect(starts.length).toBe(5)
    const duration = starts[starts.length - 1] - starts[0]
    expect(duration).toBeGreaterThanOrEqual(350)
    pool.destroy()
  })

  test('retries on 429 errors', async () => {
    const pool = new TelegramPool({
      concurrency: 1,
      ratePerSecond: 1000,
      maxRetries: 2,
      baseDelayMs: 10,
    })
    let attempts = 0

    const result = await pool.execute(async function () {
      attempts++
      if (attempts < 2) {
        const err = new Error('Too Many Requests')
        err.response = {
          error_code: 429,
          parameters: { retry_after: 0.01 },
        }
        throw err
      }
      return 'success'
    })

    expect(result).toBe('success')
    expect(attempts).toBe(2)
    pool.destroy()
  })

  test('respects Telegram retry_after header', async () => {
    const pool = new TelegramPool({
      concurrency: 1,
      ratePerSecond: 1000,
      maxRetries: 2,
      baseDelayMs: 10,
    })
    let attempts = 0
    const start = Date.now()

    const result = await pool.execute(async function () {
      attempts++
      if (attempts < 2) {
        const err = new Error('Too Many Requests')
        err.response = {
          error_code: 429,
          parameters: { retry_after: 0.05 },
        }
        throw err
      }
      return 'ok'
    })

    const elapsed = Date.now() - start
    expect(result).toBe('ok')
    expect(attempts).toBe(2)
    expect(elapsed).toBeGreaterThanOrEqual(40)
    pool.destroy()
  })

  test('does not retry non-retryable errors', async () => {
    const pool = new TelegramPool({
      concurrency: 1,
      ratePerSecond: 1000,
      maxRetries: 3,
      baseDelayMs: 10,
    })
    let attempts = 0

    await expect(
      pool.execute(async function () {
        attempts++
        const err = new Error('Not Found')
        err.response = { error_code: 404 }
        throw err
      })
    ).rejects.toThrow('Not Found')

    expect(attempts).toBe(1)
    pool.destroy()
  })

  test('does not retry on maxRetries exceeded', async () => {
    const pool = new TelegramPool({
      concurrency: 1,
      ratePerSecond: 1000,
      maxRetries: 1,
      baseDelayMs: 10,
    })
    let attempts = 0

    await expect(
      pool.execute(async function () {
        attempts++
        const err = new Error('Too Many Requests')
        err.response = {
          error_code: 429,
          parameters: { retry_after: 0.01 },
        }
        throw err
      })
    ).rejects.toThrow('Too Many Requests')

    expect(attempts).toBe(2)
    pool.destroy()
  })
})
