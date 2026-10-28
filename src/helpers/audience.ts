// The bots' audience, for Prime Radiant's catalog: per bot and chat type, how many chats
// were active in the last 7/30/90/180 days, how many exist at all, and how many are known
// to be unreachable (blocked the bot, kicked it, deleted). Counts only, never ids.
// Every query is read-only: Mongo aggregations that end in $group, one Postgres SELECT.
import axios from 'axios'
import { Pool } from 'pg'
import { createConnection, Types } from 'mongoose'

export const WINDOWS = [7, 30, 90, 180]
const DAY = 864e5
const MAX_MS = 10 * 60 * 1000

export interface Tally {
  ever: number
  unreachable: number | null // null: the bot doesn't record it
  d7: number
  d30: number
  d90: number
  d180: number
}
export interface BotAudience {
  activity: string // what counts as activity for this bot
  types: { [type: string]: Tally }
  error?: string
}
export interface Audience {
  generatedAt: string | null
  windows: number[]
  bots: { [bot: string]: BotAudience }
}

// A Telegram chat id's type: users are positive, supergroups and channels are
// -100 followed by 10 digits (they can't be told apart by id), basic groups the other negatives
export const kindOf = (id: any) => ({
  $let: {
    vars: { n: { $convert: { input: id, to: 'long', onError: null, onNull: null } } },
    in: {
      $switch: {
        branches: [
          { case: { $eq: ['$$n', null] }, then: 'unknown' },
          { case: { $gt: ['$$n', 0] }, then: 'private' },
          { case: { $lt: ['$$n', -1000000000000] }, then: 'supergroup_or_channel' },
        ],
        default: 'group',
      },
    },
  },
})

// Docs {kind, last?, unreachable?} -> one row per kind
export function tallyStage(now: Date, unreachable: boolean) {
  const group: any = {
    _id: '$kind',
    ever: { $sum: 1 },
    unreachable: unreachable ? { $sum: { $cond: ['$unreachable', 1, 0] } } : { $sum: 0 },
  }
  for (const d of WINDOWS) {
    const since = new Date(now.getTime() - d * DAY)
    group[`d${d}`] = {
      $sum: {
        $cond: [{ $and: [{ $gte: ['$last', since] }, { $not: ['$unreachable'] }] }, 1, 0],
      },
    }
  }
  return { $group: group }
}

// Rows from tallyStage (or SQL) -> { type: Tally }. `ever` rows give ever and unreachable,
// `active` rows (when the activity lives outside the chat documents) give the windows.
export function merge(ever: any[], active: any[] | null, unreachable: boolean) {
  const out: { [type: string]: Tally } = {}
  const num = (x: any) => Number(x || 0)
  for (const r of ever) {
    out[r._id] = {
      ever: num(r.ever),
      unreachable: unreachable ? num(r.unreachable) : null,
      d7: num(r.d7),
      d30: num(r.d30),
      d90: num(r.d90),
      d180: num(r.d180),
    }
  }
  for (const r of active || []) {
    const t = (out[r._id] = out[r._id] || {
      ever: 0,
      unreachable: unreachable ? 0 : null,
      d7: 0,
      d30: 0,
      d90: 0,
      d180: 0,
    })
    for (const d of WINDOWS) t[`d${d}`] = num(r[`d${d}`])
  }
  return out
}

const since = (now: Date) => new Date(now.getTime() - 180 * DAY)
const oidSince = (now: Date) =>
  Types.ObjectId.createFromTime(Math.floor(since(now).getTime() / 1000))
const createdAt = { $toDate: '$_id' }

async function mongo<T>(uri: string, run: (c: any) => Promise<T>) {
  const connection = await (createConnection(uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  } as any) as any).asPromise()
  try {
    return await run((name: string, pipeline: any[]) =>
      connection
        .collection(name)
        .aggregate(pipeline, { allowDiskUse: true, maxTimeMS: MAX_MS })
        .toArray()
    )
  } finally {
    await connection.close()
  }
}

// Events {k: chat key, t: date} from several collections -> one doc per chat with its last activity
const lastPerChat = [{ $group: { _id: '$k', last: { $max: '$t' } } }]

// Voicy: chats are documents keyed by `id` (a string). Activity: a transcription job, an
// older voice record, a new chat, or the chat becoming reachable again (/start after a block).
export function voicyPipelines(now: Date) {
  const oid = oidSince(now)
  const cut = since(now)
  return {
    ever: [
      {
        $project: {
          kind: kindOf('$id'),
          unreachable: { $eq: ['$botCanSendMessages', false] },
        },
      },
      tallyStage(now, true),
    ],
    active: [
      { $match: { _id: { $gte: oid } } },
      { $project: { k: '$chatId', t: createdAt } },
      {
        $unionWith: {
          coll: 'voices',
          pipeline: [
            { $match: { _id: { $gte: oid } } },
            { $project: { k: '$chatId', t: createdAt } },
          ],
        },
      },
      {
        $unionWith: {
          coll: 'chats',
          pipeline: [
            {
              $match: {
                $or: [
                  { _id: { $gte: oid } },
                  { transcriptionReachableAt: { $gte: cut } },
                  { promoStartAt: { $gte: cut } },
                ],
              },
            },
            {
              $project: {
                k: '$id',
                t: { $max: [createdAt, '$transcriptionReachableAt', '$promoStartAt'] },
              },
            },
          ],
        },
      },
      ...lastPerChat,
      {
        $lookup: {
          from: 'chats',
          localField: '_id',
          foreignField: 'id',
          as: 'c',
          pipeline: [{ $project: { _id: 0, b: '$botCanSendMessages' } }],
        },
      },
      {
        $project: {
          last: 1,
          kind: kindOf('$_id'),
          unreachable: { $eq: [{ $first: '$c.b' }, false] },
        },
      },
      tallyStage(now, true),
    ],
  }
}

// Banofbot: chats carry their Telegram type. Activity: a vote-ban request, a ban, a new chat.
export function banofbotPipelines(now: Date) {
  const oid = oidSince(now)
  const type = { $ifNull: ['$type', kindOf('$id')] }
  return {
    ever: [{ $project: { kind: type } }, tallyStage(now, false)],
    active: [
      { $match: { _id: { $gte: oid } } },
      { $project: { k: '$chat', t: createdAt } },
      {
        $unionWith: {
          coll: 'chats',
          pipeline: [
            { $match: { $or: [{ _id: { $gte: oid } }, { last_ban: { $gte: since(now) } }] } },
            { $project: { k: '$_id', t: { $max: [createdAt, '$last_ban'] } } },
          ],
        },
      },
      ...lastPerChat,
      {
        $lookup: {
          from: 'chats',
          localField: '_id',
          foreignField: '_id',
          as: 'c',
          pipeline: [{ $project: { _id: 0, type: 1, id: 1 } }],
        },
      },
      { $unwind: '$c' },
      { $project: { last: 1, kind: { $ifNull: ['$c.type', kindOf('$c.id')] } } },
      tallyStage(now, false),
    ],
  }
}

// Randy: chats keyed by a numeric chatId, no timestamps (the ObjectId has the creation time).
// Activity: a raffle, a new chat.
export function randymPipelines(now: Date) {
  const oid = oidSince(now)
  return {
    ever: [{ $project: { kind: kindOf('$chatId') } }, tallyStage(now, false)],
    active: [
      { $match: { _id: { $gte: oid } } },
      { $project: { k: '$chatId', t: createdAt } },
      {
        $unionWith: {
          coll: 'chats',
          pipeline: [{ $match: { _id: { $gte: oid } } }, { $project: { k: '$chatId', t: createdAt } }],
        },
      },
      ...lastPerChat,
      { $project: { last: 1, kind: kindOf('$_id') } },
      tallyStage(now, false),
    ],
  }
}

// Temply and Check my text: users (private chats) whose document changed (new user, a
// template or setting saved). Using a template inline writes nothing, so this undercounts.
export function usersPipeline(now: Date) {
  return [
    { $project: { kind: { $literal: 'private' }, last: { $ifNull: ['$updatedAt', createdAt] } } },
    tallyStage(now, false),
  ]
}

// Todorant: users who signed in with Telegram (the bot can write to them). Activity: a todo created.
export function todorantPipelines(now: Date) {
  const telegram = { telegramId: { $exists: true, $nin: [null, ''] } }
  return {
    ever: [{ $match: telegram }, { $project: { kind: { $literal: 'private' } } }, tallyStage(now, false)],
    active: [
      { $match: { _id: { $gte: oidSince(now) } } },
      { $group: { _id: '$user', last: { $max: createdAt } } },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'u',
          pipeline: [{ $match: telegram }, { $project: { _id: 1 } }],
        },
      },
      { $match: { 'u.0': { $exists: true } } },
      { $project: { last: 1, kind: { $literal: 'private' } } },
      tallyStage(now, false),
    ],
  }
}

// Jev Antispam: known_chats, one row per chat with its type and the last processed message.
export const JEV_SQL = `
  SELECT
    COALESCE(chat_type, CASE WHEN chat_id > 0 THEN 'private'
      WHEN chat_id < -1000000000000 THEN 'supergroup_or_channel' ELSE 'group' END) AS "_id",
    count(*) AS ever,
    count(*) FILTER (WHERE membership_active = false) AS unreachable,
    ${WINDOWS.map(
      (d) =>
        `count(*) FILTER (WHERE membership_active IS NOT FALSE AND last_seen_at >= now() - interval '${d} days') AS d${d}`
    ).join(',\n    ')}
  FROM known_chats GROUP BY 1`

const BOTS: {
  [bot: string]: { activity: string; run: (now: Date) => Promise<{ [type: string]: Tally }> }
} = {
  voicy: {
    activity: 'a transcription job or voice record, a new chat, or a /start after a block',
    run: (now) =>
      mongo(process.env.VOICY, async (agg) => {
        const p = voicyPipelines(now)
        return merge(await agg('chats', p.ever), await agg('transcriptionjobs', p.active), true)
      }),
  },
  banofbot: {
    activity: 'a vote-ban request or ban, or a new chat',
    run: (now) =>
      mongo(process.env.BANOFBOT, async (agg) => {
        const p = banofbotPipelines(now)
        return merge(await agg('chats', p.ever), await agg('requests', p.active), false)
      }),
  },
  randy: {
    activity: 'a raffle, or a new chat',
    run: (now) =>
      mongo(process.env.RANDYM, async (agg) => {
        const p = randymPipelines(now)
        return merge(await agg('chats', p.ever), await agg('raffles', p.active), false)
      }),
  },
  temply: {
    activity: 'a new user or a saved template or setting (inline use is not recorded)',
    run: (now) =>
      mongo(process.env.TEMPLY, async (agg) => merge(await agg('users', usersPipeline(now)), null, false)),
  },
  checkMyText: {
    activity: 'a new user or a changed setting (checks are not recorded)',
    run: (now) =>
      mongo(process.env.CHECK_MY_TEXT_BOT, async (agg) =>
        merge(await agg('users', usersPipeline(now)), null, false)
      ),
  },
  todorant: {
    activity: 'a todo created by a user who signed in with Telegram',
    run: (now) =>
      mongo(process.env.TODORANT, async (agg) => {
        const p = todorantPipelines(now)
        return merge(await agg('users', p.ever), await agg('todos', p.active), false)
      }),
  },
  jevAntispam: {
    activity: 'a message Jev processed in the chat',
    run: async () => {
      const pool = new Pool({
        connectionString: process.env.JEV_DATABASE_URL,
        max: 1,
        statement_timeout: 60000,
        application_name: 'borodutch_stats_audience',
      })
      try {
        return merge((await pool.query(JEV_SQL)).rows, null, true)
      } finally {
        await pool.end()
      }
    },
  },
  videoDownloadBot: {
    activity: 'any update from the chat (counted since 2026-10-28)',
    run: async () => {
      const url = process.env.VIDEODOWNLOADBOT_STATS_URL || 'http://bots-videodownloadbot:8080/stats'
      const audience = (await axios.get(url, { timeout: 10000 })).data.audience
      if (!audience) throw new Error('the bot has no audience counts yet')
      return audience
    },
  },
}

export let audience: Audience = { generatedAt: null, windows: WINDOWS, bots: {} }

// One bot at a time, so the databases see one aggregation each
export async function updateAudience(now = new Date()) {
  const bots: { [bot: string]: BotAudience } = {}
  for (const [name, bot] of Object.entries(BOTS)) {
    try {
      bots[name] = { activity: bot.activity, types: await bot.run(now) }
    } catch (err) {
      console.log(`audience ${name}: ${err.message}`)
      // keep the last good counts, marked with the error
      bots[name] = { ...(audience.bots[name] || { activity: bot.activity, types: {} }), error: String(err.message).slice(0, 200) }
    }
  }
  audience = { generatedAt: now.toISOString(), windows: WINDOWS, bots }
  return audience
}

let running = false
export function startAudience() {
  const tick = async () => {
    if (running) return
    running = true
    try {
      await updateAudience()
    } catch (err) {
      console.error(err)
    } finally {
      running = false
    }
  }
  setTimeout(tick, 60 * 1000)
  setInterval(tick, 12 * 3600 * 1000)
}
