// Dependencies
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'
import { fixAggregation } from './fixAggregations'

export async function getFeedr() {
  const connection = await createConnection(process.env.FEEDR, {
    useNewUrlParser: true,
  })

  const User = connection.collection('users')
  const userDaily = await (
    await User.aggregate(dailyCreatedConfig()).toArray()
  ).reverse()
  const userCount = await User.find().count()
  const Bot = connection.collection('bots')
  const botDaily = (
    await Bot.aggregate(dailyCreatedConfig()).toArray()
  ).reverse()
  const botCount = await Bot.find().count()
  await connection.close()
  return {
    botDaily: fixAggregation(botDaily.sort((a, b) => (a._id > b._id ? 1 : -1))),
    botCount,
    userDaily: fixAggregation(
      userDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ),
    userCount,
  }
}
