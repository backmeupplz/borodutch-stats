const { merge, tallyStage, JEV_SQL, WINDOWS } = require('../../dist/helpers/audience')

test('merge takes totals from chat rows and windows from activity rows', () => {
  const ever = [
    { _id: 'private', ever: 10, unreachable: 3, d7: 0, d30: 0, d90: 0, d180: 0 },
    { _id: 'group', ever: '4', unreachable: '0' },
  ]
  const active = [
    { _id: 'private', d7: 1, d30: 2, d90: 4, d180: 5 },
    { _id: 'supergroup_or_channel', d7: 1, d30: 1, d90: 1, d180: 1 },
  ]
  expect(merge(ever, active, true)).toEqual({
    private: { ever: 10, unreachable: 3, d7: 1, d30: 2, d90: 4, d180: 5 },
    group: { ever: 4, unreachable: 0, d7: 0, d30: 0, d90: 0, d180: 0 },
    supergroup_or_channel: { ever: 0, unreachable: 0, d7: 1, d30: 1, d90: 1, d180: 1 },
  })
  expect(merge(ever, null, false).private.unreachable).toBeNull()
})

test('the tally counts only active, reachable chats in each window', () => {
  const now = new Date('2026-10-28T00:00:00Z')
  const g = tallyStage(now, true).$group
  expect(Object.keys(g)).toEqual(['_id', 'ever', 'unreachable', ...WINDOWS.map((d) => `d${d}`)])
  const [since] = g.d30.$sum.$cond[0].$and[0].$gte.slice(1)
  expect(since.toISOString()).toBe('2026-09-28T00:00:00.000Z')
  expect(JEV_SQL).toMatch(/membership_active IS NOT FALSE AND last_seen_at >= now\(\) - interval '180 days'/)
})
