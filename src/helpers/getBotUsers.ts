import { createConnection } from 'mongoose'
import {
  ReachabilityMetrics,
  ReachabilityResult,
  chatKindFromTelegramType,
  emptyReachabilityMetrics,
  isPrivateChatId,
  mergeReachabilityResult,
} from './reachability'
const Telegraf = require('telegraf')

export interface BotUsersMetrics {
  legacyUserCount: number
  reachability: ReachabilityMetrics
}

export async function getBotUsers(
  name: string,
  mongo: string,
  telegramToken: string,
  idFieldName = 'id',
  chatCollectionName = 'chats'
) {
  const metrics = await getBotUsersMetrics(
    name,
    mongo,
    telegramToken,
    idFieldName,
    chatCollectionName
  )
  return metrics.legacyUserCount
}

export async function getBotUsersMetrics(
  name: string,
  mongo: string,
  telegramToken: string,
  idFieldName = 'id',
  chatCollectionName = 'chats'
): Promise<BotUsersMetrics> {
  console.log(`+ getting number of users for ${name}`)
  const connection = await createConnection(mongo, {
    useNewUrlParser: true,
  })
  const Chat = connection.collection(chatCollectionName)
  const chatCount = await Chat.find().count()
  console.log(`+ got ${chatCount} chats for ${name}, getting objects`)
  const projection = { _id: 0 }
  projection[idFieldName] = 1
  const chats = await Chat.find({}, { projection }).toArray()
  console.log(`+ got the objects for ${name}, calculating...`)
  const bot = new Telegraf(telegramToken, {
    channelMode: true,
  })
  const botInfo = await bot.telegram.getMe()
  let legacyUserCount = 0
  const reachability = emptyReachabilityMetrics()
  for (let i = 0; i < chats.length; i += 100) {
    console.log(`+ ${name}`, `${i}/${chats.length} (${legacyUserCount})`)
    const chatsToSend = chats.slice(i, i + 100)
    const promises = []
    for (const chat of chatsToSend) {
      promises.push(
        new Promise(async (res) => {
          try {
            const id = parseInt(chat[idFieldName], 10)
            // Don't even check private chats
            if (isPrivateChatId(id)) {
              const reachable = await checkPrivateReachability(bot, id)
              res({
                legacyUserCount: 1,
                reachability: {
                  reachable,
                  kind: 'private',
                },
              })
              return
            }
            const result = await checkGroupReachability(bot, id, botInfo.id)
            res({
              legacyUserCount: result.memberCount || 0,
              reachability: result,
            })
          } catch (err) {
            res({
              legacyUserCount: 0,
              reachability: {
                reachable: false,
                kind: 'unknown',
              },
            })
          }
        })
      )
    }
    const results = (await Promise.all(promises)) as {
      legacyUserCount: number
      reachability: ReachabilityResult
    }[]
    legacyUserCount += results.reduce((p, c) => p + c.legacyUserCount, 0)
    results.forEach((result) => {
      mergeReachabilityResult(reachability, result.reachability)
    })
    await delay(1)
  }
  await connection.close()
  console.log(`+ got ${legacyUserCount} users for ${name}`)
  return { legacyUserCount, reachability }
}

export async function getBotUsersForSpeller(
  name: string,
  mongo: string,
  telegramToken: string
) {
  const metrics = await getBotUsersForSpellerMetrics(name, mongo, telegramToken)
  return metrics.legacyUserCount
}

export async function getBotUsersForSpellerMetrics(
  name: string,
  mongo: string,
  telegramToken: string
): Promise<BotUsersMetrics> {
  console.log(`+ getting number of users for ${name}`)
  const connection = await createConnection(mongo, {
    useNewUrlParser: true,
  })
  const User = connection.collection('users')
  const userCount = await User.find().count()
  console.log(`+ got ${userCount} users for ${name}, getting objects`)
  const users = await User.find().toArray()
  const channels = users.reduce((p, c) => p.concat(c.channels), [])
  console.log(`+ got ${channels.length} channels for ${name}, calculating...`)
  const bot = new Telegraf(telegramToken, {
    channelMode: true,
  })
  const botInfo = await bot.telegram.getMe()
  let legacyUserCount = userCount
  const reachability = emptyReachabilityMetrics()
  for (let i = 0; i < userCount; i++) {
    mergeReachabilityResult(reachability, {
      reachable: true,
      kind: 'private',
    })
  }
  for (let i = 0; i < channels.length; i += 100) {
    const chatsToSend = channels.slice(i, i + 100)
    const promises = []
    for (const chat of chatsToSend) {
      promises.push(
        new Promise(async (res) => {
          try {
            // Don't even check private chats
            const id = parseInt(chat, 10)
            if (isPrivateChatId(id)) {
              const reachable = await checkPrivateReachability(bot, id)
              res({
                legacyUserCount: 1,
                reachability: {
                  reachable,
                  kind: 'private',
                },
              })
              return
            }
            const result = await checkGroupReachability(bot, id, botInfo.id)
            res({
              legacyUserCount: result.memberCount || 0,
              reachability: result,
            })
          } catch (err) {
            res({
              legacyUserCount: 0,
              reachability: {
                reachable: false,
                kind: 'unknown',
              },
            })
          }
        })
      )
    }
    const results = (await Promise.all(promises)) as {
      legacyUserCount: number
      reachability: ReachabilityResult
    }[]
    legacyUserCount += results.reduce((p, c) => p + c.legacyUserCount, 0)
    results.forEach((result) => {
      mergeReachabilityResult(reachability, result.reachability)
    })
    await delay(1)
  }
  await connection.close()
  console.log(`+ got ${legacyUserCount} users for ${name}`)
  return { legacyUserCount, reachability }
}

function delay(seconds) {
  return new Promise<void>((res) => {
    setTimeout(() => {
      res()
    }, seconds * 1000)
  })
}

async function checkPrivateReachability(bot, id: number) {
  try {
    await bot.telegram.getChat(id)
    return true
  } catch (err) {
    return false
  }
}

async function checkGroupReachability(
  bot,
  id: number,
  botId: number
): Promise<ReachabilityResult> {
  try {
    const chat = await bot.telegram.getChat(id)
    const member = await bot.telegram.getChatMember(id, botId)
    if (member.status === 'left' || member.status === 'kicked') {
      return { reachable: false, kind: chatKindFromTelegramType(chat.type) }
    }

    try {
      return {
        reachable: true,
        kind: chatKindFromTelegramType(chat.type),
        memberCount: await bot.telegram.getChatMembersCount(id),
      }
    } catch (err) {
      return {
        reachable: true,
        kind: chatKindFromTelegramType(chat.type),
        memberCountUnavailable: true,
      }
    }
  } catch (err) {
    return { reachable: false, kind: 'unknown' }
  }
}
