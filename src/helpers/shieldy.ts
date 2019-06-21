// Dependencies
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'

export async function getShieldy() {
  const connection = await createConnection(process.env.SHIELDY, {
    useNewUrlParser: true
  })

  const Chat = connection.collection('chats')
  const chatDaily = await Chat.aggregate(dailyCreatedConfig).toArray()
  const chatCount = await Chat.find().count()
  await connection.close()
  return {
    chatDaily,
    chatCount
  }
}
