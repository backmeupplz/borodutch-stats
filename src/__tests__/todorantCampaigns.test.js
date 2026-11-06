const mockQueries = []
const mockCampaignRows = []
let mockCampaignsFail = false
jest.mock('mongoose', () => ({
  createConnection: () => ({
    asPromise: async () => ({
      collection: (name) => ({
        aggregate: () => ({ toArray: async () => [] }),
        find: (filter, options) => {
          mockQueries.push({ name, filter, options })
          return {
            count: async () => 0,
            toArray: async () => {
              if (name !== 'campaignsignups') return []
              if (mockCampaignsFail) throw new Error('not authorized on todorant')
              return mockCampaignRows
            },
          }
        },
      }),
      close: async () => undefined,
    }),
  }),
}))

const { campaignDaily, campaignSince, getTodorant, CAMPAIGN_DAYS } = require('../../dist/helpers/todorant')

const now = new Date('2026-11-06T15:00:00Z')

test('the window is today and the 89 UTC days before it', () => {
  expect(CAMPAIGN_DAYS).toBe(90)
  expect(campaignSince(now)).toBe('2026-08-09')
  expect(campaignSince(new Date('2026-11-06T00:00:00Z'))).toBe('2026-08-09')
  expect(campaignSince(new Date('2026-11-06T23:59:59.999Z'))).toBe('2026-08-09')
})

test('rows become [{day, campaign, count}]: non-zero, in the window, oldest first', () => {
  expect(
    campaignDaily(
      [
        { day: '2026-11-06', campaign: 'p7-b', count: 1 },
        { day: '2026-11-06', campaign: 'p7-a', count: 3 },
        { day: '2026-08-09', campaign: 'old', count: 2 },
        { day: '2026-08-08', campaign: 'too-old', count: 5 },
        { day: '2026-11-07', campaign: 'future', count: 1 },
        { day: '2026-11-05', campaign: 'zero', count: 0 },
        { day: '2026-11-05', campaign: 'bad name', count: 1 },
        { day: 'yesterday', campaign: 'p7-a', count: 1 },
        { day: '2026-11-05', campaign: 'p7-a', count: 2, _id: 'x', extra: true },
      ],
      now
    )
  ).toEqual([
    { day: '2026-08-09', campaign: 'old', count: 2 },
    { day: '2026-11-05', campaign: 'p7-a', count: 2 },
    { day: '2026-11-06', campaign: 'p7-a', count: 3 },
    { day: '2026-11-06', campaign: 'p7-b', count: 1 },
  ])
  expect(campaignDaily([], now)).toEqual([])
})

test('todorant.db.campaignDaily is that array, an empty one without sign-ups', async () => {
  const empty = await getTodorant()
  expect(empty.campaignDaily).toEqual([])
  const query = mockQueries.find((q) => q.name === 'campaignsignups')
  expect(query.filter.count).toEqual({ $gt: 0 })
  expect(query.filter.day.$gte).toBe(campaignSince(new Date()))
  expect(query.options.projection).toEqual({ _id: 0, day: 1, campaign: 1, count: 1 })

  const today = new Date().toISOString().slice(0, 10)
  mockCampaignRows.push({ day: today, campaign: 'test-a', count: 1 })
  const db = await getTodorant()
  expect(db.campaignDaily).toEqual([{ day: today, campaign: 'test-a', count: 1 }])
  expect(JSON.parse(JSON.stringify(db.campaignDaily))).toEqual(db.campaignDaily)
  // The rest of todorant.db stays as it was
  expect(Object.keys(db).sort()).toEqual(['campaignDaily', 'todoCount', 'todoDaily', 'userCount', 'userDaily'])
})

const dayAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

test('unreadable counters keep the last campaignDaily, re-windowed, and the rest of todorant.db', async () => {
  mockCampaignsFail = true
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  try {
    const previous = [
      { day: dayAgo(1), campaign: 'p7-a', count: 2 },
      { day: dayAgo(0), campaign: 'p7-b', count: 1 },
    ]
    const db = await getTodorant(previous)
    expect(db.campaignDaily).toEqual(previous)
    expect(db.userCount).toBe(0)
    expect(log).toHaveBeenCalled()

    // Rows the previous value kept from before the window drop out while the reads keep failing
    const stale = await getTodorant([{ day: dayAgo(90), campaign: 'old', count: 4 }, ...previous])
    expect(stale.campaignDaily).toEqual(previous)
  } finally {
    mockCampaignsFail = false
    log.mockRestore()
  }
})

test('a failed first read (no previous value, e.g. after a restart) still gives an array', async () => {
  mockCampaignsFail = true
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  try {
    for (const previous of [undefined, null, 'garbage']) {
      const db = await getTodorant(previous)
      expect(db.campaignDaily).toEqual([])
      expect(JSON.parse(JSON.stringify(db)).campaignDaily).toEqual([])
    }
  } finally {
    mockCampaignsFail = false
    log.mockRestore()
  }
})
