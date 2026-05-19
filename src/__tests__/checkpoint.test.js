const fs = require('fs')
const path = require('path')
const { Checkpoint } = require('../../dist/helpers/checkpoint')

const CHECKPOINT_DIR = path.join(__dirname, '../../checkpoints')

function cleanupCheckpoints() {
  try {
    fs.rmSync(CHECKPOINT_DIR, { recursive: true, force: true })
  } catch (e) {}
}

describe('Checkpoint', () => {
  beforeEach(cleanupCheckpoints)
  afterAll(cleanupCheckpoints)

  test('saves and loads results', async () => {
    const cp = new Checkpoint('test-bot')
    cp.appendResult({
      chatId: 123,
      reachable: true,
      kind: 'private',
      checkedAt: 1000,
    })
    await cp.close()

    await new Promise(function (resolve) {
      setTimeout(resolve, 50)
    })

    const cp2 = new Checkpoint('test-bot')
    await cp2.load()
    expect(cp2.isProcessed(123)).toBe(true)
    expect(cp2.isProcessed(456)).toBe(false)
    const result = cp2.getResult(123)
    expect(result.reachable).toBe(true)
    expect(result.kind).toBe('private')
    expect(result.chatId).toBe(123)
  })

  test('getMetrics aggregates correctly', () => {
    const cp = new Checkpoint('metrics-test')
    cp.appendResult({
      chatId: 1,
      reachable: true,
      kind: 'private',
      checkedAt: 1,
    })
    cp.appendResult({
      chatId: 2,
      reachable: true,
      kind: 'group',
      memberCount: 50,
      checkedAt: 2,
    })
    cp.appendResult({
      chatId: 3,
      reachable: true,
      kind: 'group',
      memberCountUnavailable: true,
      checkedAt: 3,
    })
    cp.appendResult({
      chatId: 4,
      reachable: true,
      kind: 'channel',
      checkedAt: 4,
    })
    cp.appendResult({
      chatId: 5,
      reachable: false,
      kind: 'unknown',
      checkedAt: 5,
    })

    const m = cp.getMetrics()
    expect(m.reachableChatCount).toBe(4)
    expect(m.reachablePrivateChatCount).toBe(1)
    expect(m.reachableGroupChatCount).toBe(2)
    expect(m.reachableChannelCount).toBe(1)
    expect(m.totalGroupAudienceEstimate).toBe(50)
    expect(m.unavailableGroupMemberCount).toBe(1)
    expect(m.unreachableChatCount).toBe(1)
  })

  test('getLegacyCount computes correctly', () => {
    const cp = new Checkpoint('legacy-test')
    cp.appendResult({
      chatId: 1,
      reachable: true,
      kind: 'private',
      checkedAt: 1,
    })
    cp.appendResult({
      chatId: 2,
      reachable: true,
      kind: 'group',
      memberCount: 50,
      checkedAt: 2,
    })
    cp.appendResult({
      chatId: 3,
      reachable: true,
      kind: 'channel',
      memberCount: 200,
      checkedAt: 3,
    })
    cp.appendResult({
      chatId: 4,
      reachable: true,
      kind: 'group',
      memberCountUnavailable: true,
      checkedAt: 4,
    })

    expect(cp.getLegacyCount()).toBe(1 + 50 + 200)
  })

  test('resumes from checkpoint', async () => {
    const cp = new Checkpoint('resume-test')
    cp.appendResult({
      chatId: 100,
      reachable: true,
      kind: 'private',
      checkedAt: 1,
    })
    cp.appendResult({
      chatId: 200,
      reachable: false,
      kind: 'unknown',
      checkedAt: 2,
    })
    await cp.close()

    await new Promise(function (resolve) {
      setTimeout(resolve, 50)
    })

    const cp2 = new Checkpoint('resume-test')
    await cp2.load()
    expect(cp2.isProcessed(100)).toBe(true)
    expect(cp2.isProcessed(200)).toBe(true)
    expect(cp2.isProcessed(300)).toBe(false)
    expect(cp2.size()).toBe(2)
  })

  test('remove deletes checkpoint file', async () => {
    const cp = new Checkpoint('remove-test')
    cp.appendResult({
      chatId: 1,
      reachable: true,
      kind: 'private',
      checkedAt: 1,
    })
    await cp.close()
    await new Promise(function (resolve) {
      setTimeout(resolve, 50)
    })

    expect(fs.existsSync(cp.filePath)).toBe(true)
    cp.remove()
    expect(fs.existsSync(cp.filePath)).toBe(false)
  })
})
