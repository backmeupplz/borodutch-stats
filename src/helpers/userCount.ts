import axios from 'axios'
import { createConnection } from 'mongoose'
import {
  getBotReachability,
  getBotReachabilityForSpeller,
} from './getBotUsers'
import { appendFileSync, readFileSync } from 'fs'
const Telegraf = require('telegraf')

// create usercount.txt if it does not exist
try {
  readFileSync(`${__dirname}/../../usercount/usercount.txt`, 'utf8')
} catch (err) {
  appendFileSync(`${__dirname}/../../usercount/usercount.txt`, '')
  console.log('usercount.txt created')
}

let lastUserCount = 65345412
const userCountLines = readFileSync(
  `${__dirname}/../../usercount/usercount.txt`,
  'utf8'
).split('\n')
try {
  lastUserCount =
    +userCountLines[userCountLines.length - 2].split(' ')[1] || 65345412
} catch {
  // do nothing
}

console.log(
  'Recovered user count',
  lastUserCount,
  userCountLines[userCountLines.length - 2]
)

export let userCount = {
  count: lastUserCount, // data on 2021-10-10 to initialize
  history: [],
  reachability: {} as { [index: string]: any },
}

export const userCountSeparate = {} as { [index: string]: number }

export const userCountReachability = {} as { [index: string]: any }

async function updateStats() {
  // Add count history
  try {
    const history = readFileSync(
      `${__dirname}/../../usercount/usercount.txt`,
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
        `${__dirname}/../../usercount/usercount.txt`,
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
        `${__dirname}/../../usercount/usercount.txt`,
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
    const bot = new Telegraf(process.env.TOKEN)
    bot.telegram.sendMessage(
      process.env.ADMIN,
      `got overall number of users ${resultCount} in ${(
        (end.getTime() - start.getTime()) /
        1000 /
        60 /
        60
      ).toFixed(3)}h`
    )
  } catch (err) {
    const bot = new Telegraf(process.env.TOKEN)
    bot.telegram.sendMessage(
      process.env.ADMIN,
      `Could not calculate user count ${err.message}`
    )
  }
}

let updating = false
updateStats()
setInterval(async () => {
  if (updating) {
    return
  }
  try {
    updating = true
    await updateStats()
  } catch (err) {
    console.error(err)
  } finally {
    updating = false
  }
}, 24 * 60 * 60 * 1000)

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
  const connection = await createConnection(process.env.TODORANT, {
    useNewUrlParser: true,
  })
  const User = connection.collection('users')
  const userCount = await User.find().count()
  await connection.close()
  return userCount
}

async function temply() {
  const connection = await createConnection(process.env.TEMPLY, {
    useNewUrlParser: true,
  })
  const User = connection.collection('users')
  const userCount = await User.find().count()
  await connection.close()
  return userCount
}
