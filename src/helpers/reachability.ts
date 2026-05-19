export interface ReachabilityMetrics {
  reachableChatCount: number
  reachablePrivateChatCount: number
  reachableGroupChatCount: number
  reachableChannelCount: number
  totalGroupAudienceEstimate: number
  unavailableGroupMemberCount: number
  unreachableChatCount: number
}

export interface ReachabilityResult {
  reachable: boolean
  kind: 'private' | 'group' | 'channel' | 'unknown'
  memberCount?: number
  memberCountUnavailable?: boolean
}

export function emptyReachabilityMetrics(): ReachabilityMetrics {
  return {
    reachableChatCount: 0,
    reachablePrivateChatCount: 0,
    reachableGroupChatCount: 0,
    reachableChannelCount: 0,
    totalGroupAudienceEstimate: 0,
    unavailableGroupMemberCount: 0,
    unreachableChatCount: 0,
  }
}

export function mergeReachabilityResult(
  metrics: ReachabilityMetrics,
  result: ReachabilityResult
) {
  if (!result.reachable) {
    metrics.unreachableChatCount += 1
    return metrics
  }

  metrics.reachableChatCount += 1

  if (result.kind === 'private') {
    metrics.reachablePrivateChatCount += 1
    return metrics
  }

  if (result.kind === 'channel') {
    metrics.reachableChannelCount += 1
  } else {
    metrics.reachableGroupChatCount += 1
  }

  if (typeof result.memberCount === 'number') {
    metrics.totalGroupAudienceEstimate += result.memberCount
  } else if (result.memberCountUnavailable) {
    metrics.unavailableGroupMemberCount += 1
  }

  return metrics
}

export function isPrivateChatId(id: number) {
  return id > 0
}

export function chatKindFromTelegramType(type?: string) {
  if (type === 'private') {
    return 'private'
  }
  if (type === 'channel') {
    return 'channel'
  }
  if (type === 'group' || type === 'supergroup') {
    return 'group'
  }
  return 'unknown'
}
