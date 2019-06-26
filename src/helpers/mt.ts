// Dependencies
import axios from 'axios'
import { createConnection } from 'mongoose'
import { dailyCreatedConfig } from './aggregations'

export async function getMT() {
  const connection = await createConnection(process.env.MT, {
    useNewUrlParser: true,
  })

  const Order = connection.model('Order', {} as any)
  const User = connection.model('User', {} as any)

  const orderDaily = await Order.aggregate(dailyCreatedConfig)
  const orderCount = await Order.find().countDocuments()
  const userDaily = await User.aggregate(dailyCreatedConfig)
  const userCount = await User.find().countDocuments()
  await connection.close()
  return {
    orderDaily: orderDaily.sort((a, b) => (a._id > b._id ? -1 : 1)),
    orderCount,
    userDaily: userDaily.sort((a, b) => (a._id > b._id ? -1 : 1)),
    userCount,
    website: (await axios.get('https://backend.mamkin.trade/stats')).data,
  }
}
