// Dependencies
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'

export async function getRandym() {
  const connection = await createConnection(process.env.RANDYM, {
    useNewUrlParser: true,
  })

  const Raffle = connection.collection('raffles')
  const Chat = connection.collection('chats')
  const chatDaily = await Chat.aggregate(dailyCreatedConfig).toArray()
  const chatCount = await Chat.find().count()
  const raffleDaily = await Raffle.aggregate(dailyCreatedConfig).toArray()
  const raffleCount = await Raffle.find().count()
  await connection.close()
  return {
    chatDaily,
    chatCount,
    raffleDaily,
    raffleCount,
  }
}
