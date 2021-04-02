// Dependencies
import { dailyCreatedConfig } from './aggregations'
import { createConnection } from 'mongoose'
import { fixAggregation } from './fixAggregations'

export async function getTodorant() {
  const connection = await createConnection(process.env.TODORANT, {
    useNewUrlParser: true,
  })

  const User = connection.collection('users')
  const userDaily = await User.aggregate(dailyCreatedConfig()).toArray()
  const userCount = await User.find().count()
  const Todo = connection.collection('todos')
  const todoDaily = await Todo.aggregate(dailyCreatedConfig()).toArray()
  const todoCount = await Todo.find().count()
  await connection.close()
  return {
    todoDaily: fixAggregation(
      todoDaily
        .sort((a, b) => (a._id > b._id ? 1 : -1))
        .filter((a) => a._id >= 0)
    ),
    todoCount,
    userDaily: fixAggregation(
      userDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ),
    userCount,
  }
}
