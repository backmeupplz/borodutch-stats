// Dependencies
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'
import { fixAggregation } from './fixAggregations'

export async function getCheckMyTextBot() {
  const connection = await createConnection(process.env.CHECK_MY_TEXT_BOT, {
    useNewUrlParser: true,
  })

  const User = connection.collection('users')
  const userDaily = (
    await User.aggregate(dailyCreatedConfig()).toArray()
  ).reverse()
  const userCount = await User.find().count()
  await connection.close()
  return {
    userDaily: fixAggregation(
      userDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ).reverse(),
    userCount,
  }
}
