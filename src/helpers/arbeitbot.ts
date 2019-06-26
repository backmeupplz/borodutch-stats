// Dependencies
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'
import { cloudflareData } from './stats'

export async function getArbeitBot() {
  const connection = await createConnection(process.env.ARBEIT_BOT, {
    useNewUrlParser: true,
  })

  const Job = connection.collection('jobs')
  const User = connection.collection('users')
  const jobDaily = await Job.aggregate(dailyCreatedConfig).toArray()
  const jobCount = await Job.find().count()
  const userDaily = await User.aggregate(dailyCreatedConfig).toArray()
  const userCount = await User.find().count()
  await connection.close()
  return {
    jobDaily: jobDaily.sort((a, b) => (a._id > b._id ? -1 : 1)),
    jobCount,
    userDaily: userDaily.sort((a, b) => (a._id > b._id ? -1 : 1)),
    userCount,
    website: await cloudflareData('23655bf636aed23a2311f10f64dbb00a'),
  }
}
