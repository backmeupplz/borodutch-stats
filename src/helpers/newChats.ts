// New private chats per day for Voicy and Banofbot, split by the chat's language and by
// whether a campaign /start payload brought it, for Prime Radiant's Telegram search-name
// experiment. Counts only, never ids. Read-only Mongo aggregations that end in $group.
import { createConnection, Types } from 'mongoose'
import { kindOf } from './audience'

export const DAYS = 45
const DAY = 864e5
const MAX_MS = 5 * 60 * 1000
// A payload counts for a chat when it arrived within 10 minutes of the chat's creation
// (both bots use the same window for their own "new" promo events)
const FRESH_MS = 10 * 60 * 1000

export interface Split {
  organic: number
  withPayload: number
}
export interface Day extends Split {
  date: string // UTC day, YYYY-MM-DD
  partial?: true // today, still counting
  languages: { [language: string]: Split }
}
export interface BotNewChats {
  language: string // where the language comes from
  payload: string // which /start payloads are recorded
  days: Day[]
  error?: string
}
export interface NewChats {
  generatedAt: string | null
  days: number
  bots: { [bot: string]: BotNewChats }
}

// The first counted UTC day: today and the DAYS - 1 before it
export function firstDay(now: Date) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return new Date(today - (DAYS - 1) * DAY)
}

const createdAt = { $toDate: '$_id' }
const fromStart = (now: Date) => ({
  _id: { $gte: Types.ObjectId.createFromTime(Math.floor(firstDay(now).getTime() / 1000)) },
})
// Stored languages are short codes; anything else (a crafted callback) is `other`
const language = (field: any) => ({
  $let: {
    vars: { l: field },
    in: {
      $cond: [
        {
          $regexMatch: {
            input: { $cond: [{ $eq: [{ $type: '$$l' }, 'string'] }, '$$l', ''] },
            regex: '^[a-z]{2,3}(-[a-z]{2,4})?$',
          },
        },
        '$$l',
        'other',
      ],
    },
  },
})
const fresh = (at: any) => ({
  $and: [
    { $ne: [{ $ifNull: [at, null] }, null] },
    { $gte: [{ $subtract: [at, createdAt] }, 0] },
    { $lt: [{ $subtract: [at, createdAt] }, FRESH_MS] },
  ],
})
const tally = [
  {
    $group: {
      _id: { d: { $dateToString: { format: '%Y-%m-%d', date: createdAt } }, l: '$l', p: '$p' },
      n: { $sum: 1 },
    },
  },
]

// Voicy (chats): private chats have a positive `id`. `uiLanguage` is set from the user's
// Telegram language_code on every /start, mapped to an interface language (de, en, es, pt,
// ru, uk; anything else becomes en) unless they picked one with /language. A campaign
// payload is kept as promoCampaign/promoStartAt (first campaign /start only).
export function voicyPipeline(now: Date) {
  return [
    { $match: fromStart(now) },
    { $match: { $expr: { $eq: [kindOf('$id'), 'private'] } } },
    { $project: { l: language({ $ifNull: ['$uiLanguage', 'en'] }), p: fresh('$promoStartAt') } },
    ...tally,
  ]
}

// Banofbot (chats): `type` is Telegram's chat type. `language` is only what the user picked
// from the /start language keyboard (en until they pick). A campaign payload is kept in
// promos as `arrival:<chat id>` with a JSON value {payload, at} (first arrival only).
export function banofbotPipeline(now: Date) {
  return [
    { $match: { ...fromStart(now), type: 'private' } },
    {
      $lookup: {
        from: 'promos',
        let: { k: { $concat: ['arrival:', { $toString: '$id' }] } },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$k'] } } }, { $project: { _id: 0, v: 1 } }],
        as: 'a',
      },
    },
    {
      $project: {
        l: language({ $ifNull: ['$language', 'en'] }),
        at: {
          $let: {
            vars: { v: { $first: '$a.v' } },
            in: {
              $let: {
                vars: {
                  m: {
                    $regexFind: {
                      input: { $cond: [{ $eq: [{ $type: '$$v' }, 'string'] }, '$$v', ''] },
                      regex: '"at":(\\d+)',
                    },
                  },
                },
                in: { $toDate: { $toLong: { $arrayElemAt: ['$$m.captures', 0] } } },
              },
            },
          },
        },
      },
    },
    { $project: { l: 1, p: fresh('$at') } },
    ...tally,
  ]
}

// Rows {_id: {d, l, p}, n} -> every day from firstDay to today, zeros included
export function buildDays(rows: any[], now: Date): Day[] {
  const start = firstDay(now).getTime()
  const days: Day[] = []
  const byDate: { [date: string]: Day } = {}
  for (let i = 0; i < DAYS; i++) {
    const date = new Date(start + i * DAY).toISOString().slice(0, 10)
    days.push((byDate[date] = { date, organic: 0, withPayload: 0, languages: {} }))
  }
  days[DAYS - 1].partial = true
  for (const r of rows) {
    const day = byDate[r._id.d]
    if (!day) continue
    const key = r._id.p ? 'withPayload' : 'organic'
    const n = Number(r.n || 0)
    const split = (day.languages[r._id.l] = day.languages[r._id.l] || { organic: 0, withPayload: 0 })
    split[key] += n
    day[key] += n
  }
  return days
}

async function aggregate(uri: string, collection: string, pipeline: any[]) {
  const connection = await (createConnection(uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  } as any) as any).asPromise()
  try {
    return await connection
      .collection(collection)
      .aggregate(pipeline, { allowDiskUse: true, maxTimeMS: MAX_MS })
      .toArray()
  } finally {
    await connection.close()
  }
}

const BOTS: {
  [bot: string]: { language: string; payload: string; run: (now: Date) => Promise<any[]> }
} = {
  voicy: {
    language:
      "interface language, set from the user's Telegram language_code on /start (de, en, es, pt, ru, uk; any other code counts as en) unless picked with /language",
    payload: 'campaign payloads only (<campaign>-<variant>-<bot>); other /start payloads are not stored and count as organic',
    run: (now) => aggregate(process.env.VOICY, 'chats', voicyPipeline(now)),
  },
  banofbot: {
    language:
      "interface language the user picked from the /start keyboard (en until they pick); the Telegram language_code is not stored",
    payload:
      'campaign payloads only (<campaign>-<variant>-<bot>), and only while its promo hook runs (PROMO_TOKEN set, salt fetched); other /start payloads are not stored and count as organic',
    run: (now) => aggregate(process.env.BANOFBOT, 'chats', banofbotPipeline(now)),
  },
}

export let newChats: NewChats = { generatedAt: null, days: DAYS, bots: {} }

// One bot at a time, so the databases see one aggregation each
export async function updateNewChats(now = new Date()) {
  const bots: { [bot: string]: BotNewChats } = {}
  for (const [name, bot] of Object.entries(BOTS)) {
    const about = { language: bot.language, payload: bot.payload }
    try {
      bots[name] = { ...about, days: buildDays(await bot.run(now), now) }
    } catch (err) {
      console.log(`new chats ${name}: ${err.message}`)
      // keep the last good counts, marked with the error
      bots[name] = { ...(newChats.bots[name] || { ...about, days: [] }), error: String(err.message).slice(0, 200) }
    }
  }
  newChats = { generatedAt: now.toISOString(), days: DAYS, bots }
  return newChats
}

let running = false
export function startNewChats() {
  const tick = async () => {
    if (running) return
    running = true
    try {
      await updateNewChats()
    } catch (err) {
      console.error(err)
    } finally {
      running = false
    }
  }
  setTimeout(tick, 2 * 60 * 1000)
  setInterval(tick, 3 * 3600 * 1000)
}
