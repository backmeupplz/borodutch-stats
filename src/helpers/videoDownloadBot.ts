import axios from 'axios'

// The bot serves this on the Docker network (bots-videodownloadbot joins tp-borodutch)
const url =
  process.env.VIDEODOWNLOADBOT_STATS_URL ||
  'http://bots-videodownloadbot:8080/stats'

type Day = { date: string; count: number }

// The bot's [{ date: 'YYYY-MM-DD' (UTC), count }] into the series the other
// bots use: [{ _id: days ago, count }], oldest first, gaps filled with 0
export function daysAgo(days: Day[], now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const counts = new Map<number, number>()
  for (const { date, count } of days || []) {
    counts.set(Math.round((today - Date.parse(date)) / 864e5), count)
  }
  const top = Math.max(-1, ...Array.from(counts.keys()))
  return Array.from({ length: top + 1 }, (_, i) => ({
    _id: top - i,
    count: counts.get(top - i) || 0,
  }))
}

export async function getVideoDownloadBot() {
  const { chatCount, userCount, chatDaily, userDaily } = (
    await axios.get(url, { timeout: 10000 })
  ).data
  return {
    chatCount,
    userCount,
    chatDaily: daysAgo(chatDaily),
    userDaily: daysAgo(userDaily),
  }
}
