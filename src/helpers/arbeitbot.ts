// Dependencies
import { createConnection } from 'mongoose'
import { cloudflareData } from './stats'

export async function getArbeitBot() {
  const connection = await createConnection(process.env.ARBEIT_BOT, {
    useNewUrlParser: true
  })

  const Job = connection.collection('jobs')
  const User = connection.collection('users')
  const jobDaily = await Job.aggregate([
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
  ]).toArray()
  const jobCount = await Job.find().count()
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
  ]).toArray()
  const userCount = await User.find().count()
  await connection.close()
  console.log(jobDaily, jobCount, userDaily, userCount)
  return {
    jobDaily,
    jobCount,
    userDaily,
    userCount,
    website: await cloudflareData('23655bf636aed23a2311f10f64dbb00a')
  }
}
