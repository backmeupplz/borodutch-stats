import axios from 'axios'
import { createConnection } from 'mongoose'
import {
  getBotReachability,
  getBotReachabilityForSpeller,
} from './getBotUsers'
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

export const userCountReachability = {} as { [index: string]: any }

function notifyAdmin(message: string) {
  if (!process.env.TOKEN || !process.env.ADMIN) {
    return
  }
  const bot = new Telegraf(process.env.TOKEN)
  bot.telegram.sendMessage(process.env.ADMIN, message).catch((err) => {
    console.log(err)
  })
}

async function updateStats() {
  // Add count history
  try {
    userCountHistory = parseUserCountHistory()
    userCount.history = userCountHistory
    userCount.count =
      Number(userCountHistory[userCountHistory.length - 1]?.[1]) ||
      userCount.count
  } catch (err) {
    console.log(err)
  }
  console.log('+ user count recalculation is disabled')
}

async function recalculateUserCount() {
  try {
    const start = new Date()
    const result = []
    console.log('+ updating user count')
    // Shieldy
    console.log('+ getting shieldy stats')
    const shieldyStats = (await axios('http://142.93.135.209:1339/stats')).data
      .shieldy
    const shieldyUsers = shieldyStats.userCount
    result.push(shieldyUsers)
    console.log(`+ result ${result}`)
    userCountSeparate.shieldy = shieldyUsers
    // Golden borodutch
    console.log('+ getting golden borodutch stats')
    const goldenBorodutchUsers = await goldenBorodutch()
    result.push(goldenBorodutchUsers)
    console.log(`+ result ${result}`)
    console.log(`+ got golden borodutch ${goldenBorodutchUsers}`)
    userCountSeparate.goldenBorodutch = goldenBorodutchUsers
    // Todorant
    console.log('+ getting todorant stats')
    const todorantUsers = await todorant()
    result.push(todorantUsers)
    console.log(`+ result ${result}`)
    console.log(`+ got todorant ${todorantUsers}`)
    userCountSeparate.todorant = todorantUsers
    // Temply
    console.log('+ getting temply stats')
    const templyUsers = await temply()
    result.push(templyUsers)
    console.log(`+ result ${result}`)
    console.log(`+ got temply ${templyUsers}`)
    userCountSeparate.temply = templyUsers
    // Check my text bot
    const spellerReachability = await getBotReachabilityForSpeller(
      '@check_my_text_bot',
      process.env.CHECK_MY_TEXT_BOT,
      process.env.CHECK_MY_TEXT_BOT_TOKEN
    )
    result.push(spellerReachability.totalUsers)
    console.log(`+ result ${result}`)
    userCountSeparate.speller = spellerReachability.totalUsers
    userCountReachability.speller = spellerReachability
    // Randy
    const randyReachability = await getBotReachability(
      '@randymbot',
      process.env.RANDYM,
      process.env.RANDYM_TOKEN,
      'chatId'
    )
    result.push(randyReachability.totalUsers)
    console.log(`+ result ${result}`)
    userCountSeparate.randy = randyReachability.totalUsers
    userCountReachability.randy = randyReachability
    // Banofbot
    const banofbotReachability = await getBotReachability(
      '@banofbot',
      process.env.BANOFBOT,
      process.env.BANOFBOT_TOKEN
    )
    result.push(banofbotReachability.totalUsers)
    console.log(`+ result ${result}`)
    userCountSeparate.banofbot = banofbotReachability.totalUsers
    userCountReachability.banofbot = banofbotReachability
    // Voicy
    const voicyReachability = await getBotReachability(
      '@voicy_bot',
      process.env.VOICY,
      process.env.VOICY_TOKEN
    )
    result.push(voicyReachability.totalUsers)
    console.log(`+ result ${result}`)
    userCountSeparate.voicy = voicyReachability.totalUsers
    userCountReachability.voicy = voicyReachability
    // Result
    const resultCount = result
      .filter((v) => !!v && !isNaN(v))
      .reduce((a, b) => a + b, 0)
    userCount.count = resultCount
    userCount.reachability = userCountReachability
    const end = new Date()
    try {
      appendFileSync(
        userCountPath,
        `${Date.now()} ${resultCount}\n`
      )
    } catch (err) {
      console.log(err)
    }
    console.log(
      `+ got overall number of users ${resultCount} in ${(
        (end.getTime() - start.getTime()) /
        1000 /
        60 /
        60
      ).toFixed(3)}h`
    )
    // Add count history
    try {
      const history = readFileSync(
        userCountPath,
        'utf8'
      )
      const historyItems = history
        .split('\n')
        .filter((v) => !!v)
        .map((i) => i.split(' '))
      userCount.history = historyItems
    } catch (err) {
      console.log(err)
    }
    // Send message to Telegram
    notifyAdmin(
      `got overall number of users ${resultCount} in ${(
        (end.getTime() - start.getTime()) /
        1000 /
        60 /
        60
      ).toFixed(3)}h`
    )
  } catch (err) {
    notifyAdmin(`Could not calculate user count ${err.message}`)
  }
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
  const connection = await createConnection(process.env.TODORANT).asPromise()
  const User = connection.collection('users')
  const userCount = await User.find().count()
  await connection.close()
  return userCount
}

async function temply() {
  const connection = await createConnection(process.env.TEMPLY).asPromise()
  const User = connection.collection('users')
  const userCount = await User.find().count()
  await connection.close()
  return userCount
}
