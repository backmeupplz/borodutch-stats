const { daysAgo } = require('../../dist/helpers/videoDownloadBot')

test('daysAgo turns UTC dates into the days-ago series, gaps filled', () => {
  const now = new Date('2026-10-28T15:00:00Z')
  expect(
    daysAgo(
      [
        { date: '2026-10-25', count: 4 },
        { date: '2026-10-27', count: 2 },
        { date: '2026-10-28', count: 1 },
      ],
      now
    )
  ).toEqual([
    { _id: 3, count: 4 },
    { _id: 2, count: 0 },
    { _id: 1, count: 2 },
    { _id: 0, count: 1 },
  ])
  expect(daysAgo([], now)).toEqual([])
})
