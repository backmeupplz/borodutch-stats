// Dependencies
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'
import { fixAggregation } from './fixAggregations'

export async function getBanofbot() {
  const connection = await createConnection(process.env.BANOFBOT, {
    useNewUrlParser: true,
  })

  const User = connection.collection('users')
  const userDaily = await User.aggregate(dailyCreatedConfig()).toArray()
  const userCount = await User.find().count()
  const Chat = connection.collection('chats')
  const chatDaily = await Chat.aggregate(dailyCreatedConfig()).toArray()
  const chatCount = await Chat.find().count()
  const Request = connection.collection('requests')
  const requestDaily = await Request.aggregate(dailyCreatedConfig()).toArray()
  const requestCount = await Request.find().count()
  await connection.close()
  return {
    userDaily: fixAggregation(
      userDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ).reverse(),
    userCount,
    chatDaily: fixAggregation(
      chatDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ).reverse(),
    chatCount,
    requestDaily: fixAggregation(
      requestDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ).reverse(),
    requestCount,
  }
}
