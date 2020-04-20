import axios from 'axios'
import { createConnection } from 'mongoose'
import { getBotUsers, getBotUsersForSpeller } from './getBotUsers'
const Telegraf = require('telegraf')

export let userCount = {
  count: 14027403, // data on 2020-04-20 to initialize
}

async function updateStats() {
  try {
    const start = new Date()
    let result = 0
    console.log('+ updating user count')
    // Golden borodutch
    console.log('+ getting golden borodutch stats')
    const goldenBorodutcUsers = await goldenBorodutch()
    result += goldenBorodutcUsers
    console.log(`+ result ${result}`)
    console.log(`+ got golden borodutch ${goldenBorodutcUsers}`)
    // Todorant
    console.log('+ getting todorant stats')
    const todorantUsers = await todorant()
    result += todorantUsers
    console.log(`+ result ${result}`)
    console.log(`+ got todorant ${todorantUsers}`)
    // Feedr
    console.log('+ getting feedr stats')
    const feedrUsers = await feedr()
    result += feedrUsers
    console.log(`+ result ${result}`)
    console.log(`+ got feedr ${feedrUsers}`)
    // MT
    console.log('+ getting mt stats')
    const mtUsers = await mt()
    result += mtUsers
    console.log(`+ result ${result}`)
    console.log(`+ got mt ${mtUsers}`)
    // Temply
    console.log('+ getting temply stats')
    const templyUsers = await temply()
    result += templyUsers
    console.log(`+ result ${result}`)
    console.log(`+ got temply ${templyUsers}`)
    // ArbeitBot
    console.log('+ getting arbeit_bot stats')
    const arbeitBotUsers = await arbeitBot()
    result += arbeitBotUsers
    console.log(`+ result ${result}`)
    console.log(`+ got arbeit_bot ${arbeitBotUsers}`)
    // Check my text bot
    result += await getBotUsersForSpeller(
      '@check_my_text_bot',
      process.env.CHECK_MY_TEXT_BOT,
      process.env.CHECK_MY_TEXT_BOT_TOKEN
    )
    console.log(`+ result ${result}`)
    // Randy
    result += await getBotUsers(
      '@randymbot',
      process.env.RANDYM,
      process.env.RANDYM_TOKEN,
      'chatId'
    )
    console.log(`+ result ${result}`)
    // Banofbot
    result += await getBotUsers(
      '@banofbot',
      process.env.BANOFBOT,
      process.env.BANOFBOT_TOKEN
    )
    console.log(`+ result ${result}`)
    // TLGCoin
    result += await getBotUsers(
      '@tlgcoin_bot',
      process.env.TLGCOIN,
      process.env.TLGCOIN_TOKEN,
      undefined,
      'users'
    )
    console.log(`+ result ${result}`)
    // Shieldy
    result += await getBotUsers(
      '@shieldy_bot',
      process.env.SHIELDY,
      process.env.SHIELDY_TOKEN
    )
    console.log(`+ result ${result}`)
    // Voicy
    result += await getBotUsers(
      '@voicy_bot',
      process.env.VOICY,
      process.env.VOICY_TOKEN
    )
    console.log(`+ result ${result}`)
    // Result
    userCount.count = result
    const end = new Date()
    console.log(
      `+ got overall number of users ${result} in ${(
        (end.getTime() - start.getTime()) /
        1000 /
        60 /
        60
      ).toFixed(3)}h`
    )
    const bot = new Telegraf(process.env.TOKEN)
    bot.telegram.sendMessage(
      process.env.ADMIN,
      `got overall number of users ${result} in ${(
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
    return parseInt(
      /<div class="tgme_page_extra">(.+) members/
        .exec(goldenBorodutch)[1]
        .replace(' ', ''),
      10
    )
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

async function feedr() {
  const connection = await createConnection(process.env.FEEDR, {
    useNewUrlParser: true,
  })
  const User = connection.collection('users')
  const userCount = await User.find().count()
  await connection.close()
  return userCount
}

async function mt() {
  const connection = await createConnection(process.env.MT, {
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

async function arbeitBot() {
  const connection = await createConnection(process.env.ARBEIT_BOT, {
    useNewUrlParser: true,
  })
  const User = connection.collection('users')
  const userCount = await User.find().count()
  await connection.close()
  return userCount
}
