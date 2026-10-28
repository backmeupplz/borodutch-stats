const { buildDays, firstDay, voicyPipeline, banofbotPipeline, DAYS } = require('../../dist/helpers/newChats')

const now = new Date('2026-10-28T15:00:00Z')

test('the window is today and the 44 UTC days before it', () => {
  expect(firstDay(now).toISOString()).toBe('2026-09-14T00:00:00.000Z')
  const days = buildDays([], now)
  expect(days).toHaveLength(DAYS)
  expect(days[0]).toEqual({ date: '2026-09-14', organic: 0, withPayload: 0, languages: {} })
  expect(days[DAYS - 1]).toEqual({ date: '2026-10-28', partial: true, organic: 0, withPayload: 0, languages: {} })
  expect(days.filter((d) => d.partial)).toHaveLength(1)
})

test('rows become per-day organic and payload counts, by language', () => {
  const days = buildDays(
    [
      { _id: { d: '2026-10-27', l: 'ru', p: false }, n: 5 },
      { _id: { d: '2026-10-27', l: 'ru', p: true }, n: 2 },
      { _id: { d: '2026-10-27', l: 'en', p: false }, n: '3' },
      { _id: { d: '2026-09-13', l: 'en', p: false }, n: 9 }, // before the window
    ],
    now
  )
  expect(days[DAYS - 2]).toEqual({
    date: '2026-10-27',
    organic: 8,
    withPayload: 2,
    languages: { ru: { organic: 5, withPayload: 2 }, en: { organic: 3, withPayload: 0 } },
  })
  expect(days.reduce((s, d) => s + d.organic + d.withPayload, 0)).toBe(10)
})

test('both pipelines start at the window by ObjectId and end in a counts-only $group', () => {
  for (const p of [voicyPipeline(now), banofbotPipeline(now)]) {
    const since = p[0].$match._id.$gte
    expect(since.getTimestamp().toISOString()).toBe('2026-09-14T00:00:00.000Z')
    const last = p[p.length - 1]
    expect(Object.keys(last)).toEqual(['$group'])
    expect(Object.keys(last.$group)).toEqual(['_id', 'n'])
    expect(Object.keys(last.$group._id)).toEqual(['d', 'l', 'p'])
  }
  expect(banofbotPipeline(now)[0].$match.type).toBe('private')
})
