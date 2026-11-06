// Dependencies
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'
import { fixAggregation } from './fixAggregations'

/** UTC days of campaign sign-ups published: today and the 89 before it */
export const CAMPAIGN_DAYS = 90

/** The first UTC day (YYYY-MM-DD) of the campaign window */
export function campaignSince(now = new Date()) {
  const start = new Date(now.getTime())
  start.setUTCDate(start.getUTCDate() - (CAMPAIGN_DAYS - 1))
  return start.toISOString().slice(0, 10)
}

export interface CampaignDay {
  day: string
  campaign: string
  count: number
}

/**
 * Todorant's `campaignsignups` counters (new accounts per UTC day and utm_campaign, nothing per person) as
 * `[{day, campaign, count}]`: the window's non-zero rows, oldest first. Prime Radiant's conversions read this
 */
export function campaignDaily(rows: any[], now = new Date()): CampaignDay[] {
  const since = campaignSince(now)
  const today = now.toISOString().slice(0, 10)
  return rows
    .map(({ day, campaign, count }) => ({
      day,
      campaign,
      count: Number(count),
    }))
    .filter(
      ({ day, campaign, count }) =>
        typeof day === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(day) &&
        day >= since &&
        day <= today &&
        typeof campaign === 'string' &&
        /^[A-Za-z0-9_-]{1,64}$/.test(campaign) &&
        Number.isInteger(count) &&
        count > 0
    )
    .sort((a, b) =>
      a.day !== b.day
        ? a.day < b.day
          ? -1
          : 1
        : a.campaign < b.campaign
        ? -1
        : a.campaign > b.campaign
        ? 1
        : 0
    )
}

/**
 * When only the campaign counters can't be read, [previousCampaignDaily] stays, re-windowed to the last 90 days
 * (an empty array without one): `campaignDaily` is always an array
 */
export async function getTodorant(previousCampaignDaily?: CampaignDay[]) {
  const connection = await createConnection(process.env.TODORANT).asPromise()

  const User = connection.collection('users')
  const userDaily = await User.aggregate(dailyCreatedConfig()).toArray()
  const userCount = await User.find().count()
  const Todo = connection.collection('todos')
  const todoDaily = await Todo.aggregate(dailyCreatedConfig()).toArray()
  const todoCount = await Todo.find().count()
  const now = new Date()
  let campaigns: CampaignDay[]
  try {
    campaigns = campaignDaily(
      await connection
        .collection('campaignsignups')
        .find(
          { day: { $gte: campaignSince(now) }, count: { $gt: 0 } },
          { projection: { _id: 0, day: 1, campaign: 1, count: 1 } }
        )
        .toArray(),
      now
    )
  } catch (err) {
    console.log('Todorant campaign sign-ups:', err?.message)
    campaigns = campaignDaily(
      Array.isArray(previousCampaignDaily) ? previousCampaignDaily : [],
      now
    )
  }
  await connection.close()
  return {
    todoDaily: fixAggregation(
      todoDaily
        .sort((a, b) => (a._id > b._id ? 1 : -1))
        .filter((a) => a._id >= 0)
    ).reverse(),
    todoCount,
    userDaily: fixAggregation(
      userDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ).reverse(),
    userCount,
    campaignDaily: campaigns,
  }
}
