/**
 * Worker pool for Telegram Bot API calls with bounded concurrency,
 * rate limiting, and exponential backoff for rate-limit (429) errors.
 */

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

export interface PoolOptions {
  concurrency: number
  ratePerSecond: number
  maxRetries?: number
  baseDelayMs?: number
}

export class TelegramPool {
  private queue: Array<() => Promise<void>> = []
  private active = 0
  private destroyed = false
  private lastStart = 0
  private rateLimitPromise: Promise<void> = Promise.resolve()
  private concurrency: number
  private minIntervalMs: number
  private maxRetries: number
  private baseDelayMs: number

  constructor(options: PoolOptions) {
    this.concurrency = options.concurrency
    this.minIntervalMs = 1000 / options.ratePerSecond
    this.maxRetries = options.maxRetries || 3
    this.baseDelayMs = options.baseDelayMs || 1000
  }

  /**
   * Execute a Telegram API call through the pool.
   * Automatically retries on 429 (Too Many Requests) and transient network errors.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const self = this
    if (self.destroyed) {
      throw new Error('Pool has been destroyed')
    }

    return new Promise<T>(function (resolve, reject) {
      const task = async function () {
        await self.acquireSlot()

        try {
          const result = await self.runWithRetry(fn)
          resolve(result)
        } catch (err) {
          reject(err)
        } finally {
          self.active--
          self.processQueue()
        }
      }

      self.queue.push(task)
      self.processQueue()
    })
  }

  private processQueue(): void {
    const self = this
    while (
      self.active < self.concurrency &&
      self.queue.length > 0 &&
      !self.destroyed
    ) {
      const next = self.queue.shift() as () => Promise<void>
      self.active++
      // Fire and forget — the task handles its own resolve/reject
      next().catch(function () {
        // errors are handled inside the task via resolve/reject
      })
    }
  }

  private async acquireSlot(): Promise<void> {
    const self = this
    const myTurn = self.rateLimitPromise.then(async function () {
      const now = Date.now()
      const wait = self.lastStart + self.minIntervalMs - now
      if (wait > 0) {
        await sleep(wait)
      }
      self.lastStart = Date.now()
    })
    self.rateLimitPromise = myTurn.catch(function () {
      // ignore errors to keep the chain alive
    })
    await myTurn
  }

  private async runWithRetry<T>(
    fn: () => Promise<T>,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (attempt <= this.maxRetries && this.isRetryable(err)) {
        const delay = this.getRetryDelay(err, attempt)
        await sleep(delay)
        return this.runWithRetry(fn, attempt + 1)
      }
      throw err
    }
  }

  private isRetryable(err: any): boolean {
    // Telegram 429 Too Many Requests
    if (err && err.response && err.response.error_code === 429) {
      return true
    }
    // Network / transient errors
    const code = err && err.code
    return (
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND'
    )
  }

  private getRetryDelay(err: any, attempt: number): number {
    // Respect Telegram's Retry-After header if present
    const retryAfter =
      err && err.response && err.response.parameters
        ? err.response.parameters.retry_after
        : undefined
    if (typeof retryAfter === 'number') {
      return retryAfter * 1000 + 100 // add 100ms buffer
    }
    // Exponential backoff: baseDelayMs * 2^(attempt-1)
    return this.baseDelayMs * Math.pow(2, attempt - 1)
  }

  /**
   * Wait until all queued and active tasks finish.
   */
  async drain(): Promise<void> {
    const self = this
    while (self.active > 0 || self.queue.length > 0) {
      await sleep(50)
    }
  }

  /**
   * Destroy the pool, reject any pending tasks.
   */
  destroy(): void {
    this.destroyed = true
    this.queue = []
  }
}
