import axios from 'axios'
import { createConnection } from 'mongoose'
import {
  getBotUsersOptimized,
  getBotUsersForSpellerOptimized,
} from './optimizedGetBotUsers'
import { emptyReachabilityMetrics } from './reachability'
import { appendFileSync, mkdirSync, readFileSync } from 'fs'
const Telegraf = require('telegraf')

const userCountPath = `${__dirname}/../../usercount/usercount.txt`
const minimumValidUserCount = 100_000_000
const suspiciousHistoryWindow = 25

// create usercount.txt if it does not exist
try {
  mkdirSync(`${__dirname}/../../usercount`, { recursive: true })
  readFileSync(userCountPath, 'utf8')
} catch (err) {
  appendFileSync(userCountPath, '')
  console.log('usercount.txt created')
}

function parseUserCountHistory() {
  const history = readFileSync(userCountPath, 'utf8')
  const historyItems = history
    .split('\n')
    .filter((v) => !!v)
    .map((i) => i.split(' '))
  const recentItems = historyItems.slice(-suspiciousHistoryWindow)
  if (
    recentItems.some(
      (item) => Number(item[1]) > 0 && Number(item[1]) < minimumValidUserCount
    )
  ) {
    return historyItems.slice(0, -suspiciousHistoryWindow)
  }
  return historyItems
}

let userCountHistory = parseUserCountHistory()
let lastUserCount =
  Number(userCountHistory[userCountHistory.length - 1]?.[1]) || 65345412

console.log('Recovered user count', lastUserCount)

export let userCount = {
  count: lastUserCount, // data on 2021-10-10 to initialize
  history: userCountHistory,
  reachability: {} as { [index: string]: any },
}

export const userCountSeparate = {} as { [index: string]: number }

export let userCountReachability = {
  total: emptyReachabilityMetrics(),
  bots: {} as { [index: string]: any },
}

/**
 * Standalone stats collection (no interval, no auto-run).
 * Can be called from CLI or server startup.
 */
export async function runCollection(): Promise<{
  count: number
  reachability: typeof userCountReachability
  perBot: typeof userCountSeparate
}> {
  // Add count history
  try {
    const history = readFileSync(userCountPath, 'utf8')
    const historyItems = history
      .split('\n')
      .filter(function (v) {
        return !!v
      })
      .map(function (i) {
        return i.split(' ')
      })
    userCount.history = historyItems as any
  } catch (err) {
    console.log(err)
  }

  const start = new Date()
  const legacyResult: number[] = []
  const reachabilityBots: { [index: string]: any } = {}

  console.log('+ updating user count')

  // Shieldy
  console.log('+ getting shieldy stats')
  const shieldyStats = (await axios('http://142.93.135.209:1339/stats')).data
    .shieldy
  const shieldyUsers = shieldyStats.userCount
  legacyResult.push(shieldyUsers)
  console.log('+ result ' + JSON.stringify(legacyResult))
  userCountSeparate.shieldy = shieldyUsers

  // Golden borodutch
  console.log('+ getting golden borodutch stats')
  const goldenBorodutchUsers = await goldenBorodutch()
  legacyResult.push(goldenBorodutchUsers)
  console.log('+ result ' + JSON.stringify(legacyResult))
  console.log('+ got golden borodutch ' + goldenBorodutchUsers)
  userCountSeparate.goldenBorodutch = goldenBorodutchUsers

  // Todorant
  console.log('+ getting todorant stats')
  const todorantUsers = await todorant()
  legacyResult.push(todorantUsers)
  console.log('+ result ' + JSON.stringify(legacyResult))
  console.log('+ got todorant ' + todorantUsers)
  userCountSeparate.todorant = todorantUsers

  // Temply
  console.log('+ getting temply stats')
  const templyUsers = await temply()
  legacyResult.push(templyUsers)
  console.log('+ result ' + JSON.stringify(legacyResult))
  console.log('+ got temply ' + templyUsers)
  userCountSeparate.temply = templyUsers

  // Bot reachability — run in parallel with bounded concurrency per bot
  console.log('+ starting parallel bot reachability checks')
  const botResults = await Promise.all([
    getBotUsersForSpellerOptimized(
      '@check_my_text_bot',
      process.env.CHECK_MY_TEXT_BOT as string,
      process.env.CHECK_MY_TEXT_BOT_TOKEN as string
    ).catch(function (err: any) {
      console.error('+ speller failed:', err && err.message ? err.message : err)
      return { legacyUserCount: 0, reachability: emptyReachabilityMetrics() }
    }),
    getBotUsersOptimized(
      '@randymbot',
      process.env.RANDYM as string,
      process.env.RANDYM_TOKEN as string,
      'chatId'
    ).catch(function (err: any) {
      console.error('+ randy failed:', err && err.message ? err.message : err)
      return { legacyUserCount: 0, reachability: emptyReachabilityMetrics() }
    }),
    getBotUsersOptimized(
      '@banofbot',
      process.env.BANOFBOT as string,
      process.env.BANOFBOT_TOKEN as string
    ).catch(function (err: any) {
      console.error('+ banofbot failed:', err && err.message ? err.message : err)
      return { legacyUserCount: 0, reachability: emptyReachabilityMetrics() }
    }),
    getBotUsersOptimized(
      '@voicy_bot',
      process.env.VOICY as string,
      process.env.VOICY_TOKEN as string
    ).catch(function (err: any) {
      console.error('+ voicy failed:', err && err.message ? err.message : err)
      return { legacyUserCount: 0, reachability: emptyReachabilityMetrics() }
    }),
  ])

  const spellerMetrics = botResults[0]
  const randyMetrics = botResults[1]
  const banofbotMetrics = botResults[2]
  const voicyMetrics = botResults[3]

  // Legacy counts
  legacyResult.push(spellerMetrics.legacyUserCount)
  legacyResult.push(randyMetrics.legacyUserCount)
  legacyResult.push(banofbotMetrics.legacyUserCount)
  legacyResult.push(voicyMetrics.legacyUserCount)

  userCountSeparate.speller = spellerMetrics.legacyUserCount
  userCountSeparate.randy = randyMetrics.legacyUserCount
  userCountSeparate.banofbot = banofbotMetrics.legacyUserCount
  userCountSeparate.voicy = voicyMetrics.legacyUserCount

  console.log('+ result ' + JSON.stringify(legacyResult))

  // Reachability per bot
  reachabilityBots.speller = spellerMetrics.reachability
  reachabilityBots.randy = randyMetrics.reachability
  reachabilityBots.banofbot = banofbotMetrics.reachability
  reachabilityBots.voicy = voicyMetrics.reachability

  // Aggregate total reachability
  const totalReachability = emptyReachabilityMetrics()
  const keys = Object.keys(reachabilityBots)
  for (let i = 0; i < keys.length; i++) {
    const m = reachabilityBots[keys[i]]
    totalReachability.reachableChatCount += m.reachableChatCount
    totalReachability.reachablePrivateChatCount += m.reachablePrivateChatCount
    totalReachability.reachableGroupChatCount += m.reachableGroupChatCount
    totalReachability.reachableChannelCount += m.reachableChannelCount
    totalReachability.totalGroupAudienceEstimate += m.totalGroupAudienceEstimate
    totalReachability.unavailableGroupMemberCount += m.unavailableGroupMemberCount
    totalReachability.unreachableChatCount += m.unreachableChatCount
  }

  userCountReachability = {
    total: totalReachability,
    bots: reachabilityBots,
  }
  userCount.reachability = userCountReachability

  // Final legacy count
  const resultCount = legacyResult
    .filter(function (v) {
      return !!v && !isNaN(v)
    })
    .reduce(function (a, b) {
      return a + b
    }, 0)
  userCount.count = resultCount

  const end = new Date()
  const durationHours = (
    (end.getTime() - start.getTime()) /
    1000 /
    60 /
    60
  ).toFixed(3)

  try {
    appendFileSync(
      userCountPath,
      `${Date.now()} ${resultCount}\n`
    )
  } catch (err) {
    console.log(err)
  }

  console.log(
    '+ got overall number of users ' + resultCount + ' in ' + durationHours + 'h'
  )
  console.log(
    '+ reachability: total=' + totalReachability.reachableChatCount +
    ' private=' + totalReachability.reachablePrivateChatCount +
    ' group=' + totalReachability.reachableGroupChatCount +
    ' channel=' + totalReachability.reachableChannelCount +
    ' audience=' + totalReachability.totalGroupAudienceEstimate +
    ' unavailable=' + totalReachability.unavailableGroupMemberCount +
    ' unreachable=' + totalReachability.unreachableChatCount
  )

  // Add count history
  try {
    const history = readFileSync(userCountPath, 'utf8')
    const historyItems = history
      .split('\n')
      .filter(function (v) {
        return !!v
      })
      .map(function (i) {
        return i.split(' ')
      })
    userCount.history = historyItems as any
  } catch (err) {
    console.log(err)
  }

  notifyAdmin(
    'got overall number of users ' + resultCount + ' in ' + durationHours + 'h' +
    '\nreachability: total=' + totalReachability.reachableChatCount +
    ' private=' + totalReachability.reachablePrivateChatCount +
    ' group=' + totalReachability.reachableGroupChatCount +
    ' channel=' + totalReachability.reachableChannelCount +
    ' audience=' + totalReachability.totalGroupAudienceEstimate +
    ' unreachable=' + totalReachability.unreachableChatCount
  )

  return {
    count: resultCount,
    reachability: userCountReachability,
    perBot: userCountSeparate,
  }
}

async function updateStats() {
  try {
    userCountHistory = parseUserCountHistory()
    userCount.history = userCountHistory
    userCount.count =
      Number(userCountHistory[userCountHistory.length - 1]?.[1]) ||
      userCount.count
  } catch (err) {
    console.error(err)
  }
  console.log('+ user count recalculation is disabled')
}

function notifyAdmin(message: string) {
  if (!process.env.TOKEN || !process.env.ADMIN) {
    return
  }
  const bot = new Telegraf(process.env.TOKEN)
  bot.telegram.sendMessage(process.env.ADMIN, message).catch((err) => {
    console.log(err)
  })
}

updateStats()

async function goldenBorodutch() {
  try {
    const goldenBorodutch = (await axios.get('https://t.me/golden_borodutch'))
      .data
    const goldenBorodutchNumber = /<div class="tgme_page_extra">(.+) \D+/
      .exec(goldenBorodutch)[1]
      .replace(' ', '')
    return parseInt(goldenBorodutchNumber, 10)
  } catch (err) {
    console.log(err)
  }
}

async function todorant() {
  const connection = await (createConnection(process.env.TODORANT as string, {
    useNewUrlParser: true,
  } as any) as any).asPromise()
  const User = connection.collection('users')
  const userCount = await User.find().count()
  await connection.close()
  return userCount
}

async function temply() {
  const connection = await (createConnection(process.env.TEMPLY as string, {
    useNewUrlParser: true,
  } as any) as any).asPromise()
  const User = connection.collection('users')
  const userCount = await User.find().count()
  await connection.close()
  return userCount
}
