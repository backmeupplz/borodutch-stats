const {
  emptyReachabilityMetrics,
  mergeReachabilityResult,
  isPrivateChatId,
  chatKindFromTelegramType,
} = require('../../dist/helpers/reachability')

describe('reachability', () => {
  test('emptyReachabilityMetrics returns zeros', () => {
    const m = emptyReachabilityMetrics()
    expect(m.reachableChatCount).toBe(0)
    expect(m.reachablePrivateChatCount).toBe(0)
    expect(m.reachableGroupChatCount).toBe(0)
    expect(m.reachableChannelCount).toBe(0)
    expect(m.totalGroupAudienceEstimate).toBe(0)
    expect(m.unavailableGroupMemberCount).toBe(0)
    expect(m.unreachableChatCount).toBe(0)
  })

  test('isPrivateChatId identifies private chats', () => {
    expect(isPrivateChatId(123456)).toBe(true)
    expect(isPrivateChatId(1)).toBe(true)
    expect(isPrivateChatId(-100123)).toBe(false)
    expect(isPrivateChatId(-1)).toBe(false)
    expect(isPrivateChatId(0)).toBe(false)
  })

  test('chatKindFromTelegramType maps types', () => {
    expect(chatKindFromTelegramType('private')).toBe('private')
    expect(chatKindFromTelegramType('group')).toBe('group')
    expect(chatKindFromTelegramType('supergroup')).toBe('group')
    expect(chatKindFromTelegramType('channel')).toBe('channel')
    expect(chatKindFromTelegramType(undefined)).toBe('unknown')
    expect(chatKindFromTelegramType(null)).toBe('unknown')
    expect(chatKindFromTelegramType('')).toBe('unknown')
  })

  test('mergeReachabilityResult aggregates private chats', () => {
    const m = emptyReachabilityMetrics()
    mergeReachabilityResult(m, { reachable: true, kind: 'private' })
    expect(m.reachableChatCount).toBe(1)
    expect(m.reachablePrivateChatCount).toBe(1)
    expect(m.reachableGroupChatCount).toBe(0)
    expect(m.reachableChannelCount).toBe(0)
  })

  test('mergeReachabilityResult aggregates groups with memberCount', () => {
    const m = emptyReachabilityMetrics()
    mergeReachabilityResult(m, {
      reachable: true,
      kind: 'group',
      memberCount: 50,
    })
    expect(m.reachableChatCount).toBe(1)
    expect(m.reachableGroupChatCount).toBe(1)
    expect(m.totalGroupAudienceEstimate).toBe(50)
  })

  test('mergeReachabilityResult aggregates channels', () => {
    const m = emptyReachabilityMetrics()
    mergeReachabilityResult(m, { reachable: true, kind: 'channel' })
    expect(m.reachableChannelCount).toBe(1)
    expect(m.totalGroupAudienceEstimate).toBe(0)
  })

  test('mergeReachabilityResult handles memberCountUnavailable', () => {
    const m = emptyReachabilityMetrics()
    mergeReachabilityResult(m, {
      reachable: true,
      kind: 'group',
      memberCountUnavailable: true,
    })
    expect(m.reachableGroupChatCount).toBe(1)
    expect(m.unavailableGroupMemberCount).toBe(1)
    expect(m.totalGroupAudienceEstimate).toBe(0)
  })

  test('mergeReachabilityResult counts unreachable chats', () => {
    const m = emptyReachabilityMetrics()
    mergeReachabilityResult(m, { reachable: false, kind: 'unknown' })
    expect(m.unreachableChatCount).toBe(1)
    expect(m.reachableChatCount).toBe(0)
  })

  test('mergeReachabilityResult aggregates multiple results', () => {
    const m = emptyReachabilityMetrics()
    mergeReachabilityResult(m, { reachable: true, kind: 'private' })
    mergeReachabilityResult(m, {
      reachable: true,
      kind: 'group',
      memberCount: 10,
    })
    mergeReachabilityResult(m, { reachable: true, kind: 'channel' })
    mergeReachabilityResult(m, { reachable: false, kind: 'unknown' })
    expect(m.reachableChatCount).toBe(3)
    expect(m.reachablePrivateChatCount).toBe(1)
    expect(m.reachableGroupChatCount).toBe(1)
    expect(m.reachableChannelCount).toBe(1)
    expect(m.totalGroupAudienceEstimate).toBe(10)
    expect(m.unreachableChatCount).toBe(1)
  })
})
