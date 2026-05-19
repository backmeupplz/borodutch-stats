/**
 * File-based checkpoint system for resumable bot-reachability progress.
 * Uses JSON Lines (one JSON object per line) for efficient append-only writes.
 */

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
} from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'

const CHECKPOINT_DIR = join(__dirname, '../../checkpoints')

export interface ChatResult {
  chatId: number
  reachable: boolean
  kind: 'private' | 'group' | 'channel' | 'unknown'
  memberCount?: number
  memberCountUnavailable?: boolean
  checkedAt: number
}

export interface CheckpointMetrics {
  reachableChatCount: number
  reachablePrivateChatCount: number
  reachableGroupChatCount: number
  reachableChannelCount: number
  totalGroupAudienceEstimate: number
  unavailableGroupMemberCount: number
  unreachableChatCount: number
}

export class Checkpoint {
  private filePath: string
  private processedIds = new Set<number>()
  private results = new Map<number, ChatResult>()
  private writeStream: any = null

  constructor(botName: string) {
    if (!existsSync(CHECKPOINT_DIR)) {
      mkdirSync(CHECKPOINT_DIR, { recursive: true })
    }
    this.filePath = join(CHECKPOINT_DIR, botName + '.jsonl')
  }

  /**
   * Load previously saved checkpoint from disk.
   */
  async load(): Promise<void> {
    const self = this
    if (!existsSync(self.filePath)) {
      return
    }

    return new Promise(function (resolve, reject) {
      const rl = createInterface({
        input: createReadStream(self.filePath),
        crlfDelay: Infinity,
      })

      rl.on('line', function (line: string) {
        if (!line || !line.trim()) {
          return
        }
        try {
          const entry = JSON.parse(line)
          self.processedIds.add(entry.id)
          self.results.set(entry.id, {
            chatId: entry.id,
            reachable: entry.r,
            kind: entry.k,
            memberCount:
              typeof entry.m === 'number' ? entry.m : undefined,
            memberCountUnavailable: entry.mu || false,
            checkedAt: entry.t,
          })
        } catch (e) {
          // skip malformed lines
        }
      })

      rl.on('close', function () {
        resolve()
      })

      rl.on('error', function (err: any) {
        reject(err)
      })
    })
  }

  isProcessed(chatId: number): boolean {
    return this.processedIds.has(chatId)
  }

  getResult(chatId: number): ChatResult | undefined {
    return this.results.get(chatId)
  }

  /**
   * Append a single result to the checkpoint file (and in-memory cache).
   */
  appendResult(result: ChatResult): void {
    const line = JSON.stringify({
      id: result.chatId,
      r: result.reachable,
      k: result.kind,
      m: result.memberCount,
      mu: result.memberCountUnavailable,
      t: result.checkedAt,
    })

    if (!this.writeStream) {
      this.writeStream = createWriteStream(this.filePath, { flags: 'a' })
    }
    this.writeStream.write(line + '\n')
    this.processedIds.add(result.chatId)
    this.results.set(result.chatId, result)
  }

  /**
   * Close the write stream.
   */
  close(): Promise<void> {
    const self = this
    if (!self.writeStream) {
      return Promise.resolve()
    }
    return new Promise(function (resolve, reject) {
      self.writeStream!.on('finish', function () {
        self.writeStream = null
        resolve()
      })
      self.writeStream!.on('error', function (err: any) {
        self.writeStream = null
        reject(err)
      })
      self.writeStream!.end()
    })
  }

  /**
   * Compute aggregate reachability metrics from all saved results.
   */
  getMetrics(): CheckpointMetrics {
    let reachableChatCount = 0
    let reachablePrivateChatCount = 0
    let reachableGroupChatCount = 0
    let reachableChannelCount = 0
    let totalGroupAudienceEstimate = 0
    let unavailableGroupMemberCount = 0
    let unreachableChatCount = 0

    for (const result of this.results.values()) {
      if (!result.reachable) {
        unreachableChatCount++
        continue
      }
      reachableChatCount++
      if (result.kind === 'private') {
        reachablePrivateChatCount++
      } else if (result.kind === 'channel') {
        reachableChannelCount++
      } else {
        reachableGroupChatCount++
        if (typeof result.memberCount === 'number') {
          totalGroupAudienceEstimate += result.memberCount
        } else if (result.memberCountUnavailable) {
          unavailableGroupMemberCount++
        }
      }
    }

    return {
      reachableChatCount,
      reachablePrivateChatCount,
      reachableGroupChatCount,
      reachableChannelCount,
      totalGroupAudienceEstimate,
      unavailableGroupMemberCount,
      unreachableChatCount,
    }
  }

  /**
   * Compute the legacy user count (1 per private chat + memberCount per group).
   */
  getLegacyCount(): number {
    let count = 0
    for (const result of this.results.values()) {
      if (result.kind === 'private') {
        count += 1
      } else if (
        (result.kind === 'group' || result.kind === 'channel') &&
        typeof result.memberCount === 'number'
      ) {
        count += result.memberCount
      }
    }
    return count
  }

  /**
   * Number of chats stored in the checkpoint.
   */
  size(): number {
    return this.results.size
  }

  /**
   * Remove the checkpoint file from disk.
   */
  remove(): void {
    this.close()
    try {
      const fs = require('fs')
      fs.unlinkSync(this.filePath)
    } catch (e) {
      // ignore errors
    }
  }
}
