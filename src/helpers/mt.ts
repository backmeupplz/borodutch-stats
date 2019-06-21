// Dependencies
import axios from 'axios'
import { createConnection } from 'mongoose'

export async function getMT() {
  const connection = await createConnection(process.env.MT, {
    useNewUrlParser: true
  })

  const Order = connection.model('Order', {} as any)
  const User = connection.model('User', {} as any)

  const orderDaily = await Order.aggregate([
    {
      $project: {
        _id: '$_id',
        time: {
          $divide: [
            {
              $subtract: [
                { $subtract: [new Date(), '$createdAt'] },
                {
                  $mod: [
                    { $subtract: [new Date(), '$createdAt'] },
                    24 * 60 * 60 * 1000
                  ]
                }
              ]
            },
            24 * 60 * 60 * 1000
          ]
        }
      }
    },
    {
      $group: { _id: '$time', count: { $sum: 1 } }
    },
    { $sort: { _id: -1 } }
  ])
  const orderCount = await Order.find().countDocuments()
  const userDaily = await User.aggregate([
    {
      $project: {
        _id: '$_id',
        time: {
          $divide: [
            {
              $subtract: [
                { $subtract: [new Date(), '$createdAt'] },
                {
                  $mod: [
                    { $subtract: [new Date(), '$createdAt'] },
                    24 * 60 * 60 * 1000
                  ]
                }
              ]
            },
            24 * 60 * 60 * 1000
          ]
        }
      }
    },
    {
      $group: { _id: '$time', count: { $sum: 1 } }
    },
    { $sort: { _id: -1 } }
  ])
  const userCount = await User.find().countDocuments()
  await connection.close()
  return {
    orderDaily,
    orderCount,
    userDaily,
    userCount,
    website: (await axios.get('https://backend.mamkin.trade/stats')).data
  }
}
