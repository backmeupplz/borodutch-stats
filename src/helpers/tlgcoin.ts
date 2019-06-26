// Dependencies
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'

export async function getTlgcoin() {
  const connection = await createConnection(process.env.TLGCOIN, {
    useNewUrlParser: true,
  })

  const User = connection.collection('users')
  const userDaily = await User.aggregate(dailyCreatedConfig).toArray()
  const userCount = await User.find().count()
  const coinsCount = (await User.aggregate([
    {
      $group: {
        _id: 'Stats',
        totalAmount: { $sum: '$balance' },
        count: { $sum: 1 },
      },
    },
  ]).toArray())[0].totalAmount
  await connection.close()
  return {
    userDaily: userDaily.sort((a, b) => (a._id > b._id ? 1 : -1)),
    userCount,
    coinsCount,
  }
}
