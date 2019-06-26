// Dependencies
import { templatesCount } from './aggregations'
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'

export async function getTemply() {
  const connection = await createConnection(process.env.TEMPLY, {
    useNewUrlParser: true,
  })

  const User = connection.collection('users')
  const userDaily = await User.aggregate(dailyCreatedConfig).toArray()
  const userCount = await User.find().count()
  const tCount = (await User.aggregate(templatesCount).toArray())[0].templates
  await connection.close()
  return {
    userDaily: userDaily.sort((a, b) => (a._id > b._id ? -1 : 1)),
    userCount,
    templatesCount: tCount,
  }
}
