// Dependencies
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'

export async function getBanofbot() {
  const connection = await createConnection(process.env.BANOFBOT, {
    useNewUrlParser: true,
  })

  const User = connection.collection('users')
  const userDaily = await User.aggregate(dailyCreatedConfig).toArray()
  const userCount = await User.find().count()
  const Chat = connection.collection('chats')
  const chatDaily = await Chat.aggregate(dailyCreatedConfig).toArray()
  const chatCount = await Chat.find().count()
  const Request = connection.collection('requests')
  const requestDaily = await Request.aggregate(dailyCreatedConfig).toArray()
  const requestCount = await Request.find().count()
  await connection.close()
  return {
    userDaily,
    userCount,
    chatDaily,
    chatCount,
    requestDaily,
    requestCount,
  }
}
