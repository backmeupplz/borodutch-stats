// Dependencies
import axios from 'axios'
import { createConnection } from 'mongoose'
import { dailyCreatedConfig } from './aggregations'
import { fixAggregation } from './fixAggregations'

export async function getMT() {
  const connection = await createConnection(process.env.MT, {
    useNewUrlParser: true,
  })

  const Order = connection.model('Order', {} as any)
  const User = connection.model('User', {} as any)

  const orderDaily = await Order.aggregate(dailyCreatedConfig())
  const orderCount = await Order.find().countDocuments()
  const userDaily = await User.aggregate(dailyCreatedConfig())
  const userCount = await User.find().countDocuments()
  await connection.close()
  return {
    orderDaily: fixAggregation(
      orderDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ).reverse(),
    orderCount,
    userDaily: fixAggregation(
      userDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ).reverse(),
    userCount,
    website: (await axios.get('https://backend.mamkin.trade/stats')).data,
  }
}
