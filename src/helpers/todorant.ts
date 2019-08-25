// Dependencies
import axios from 'axios'
import { createConnection } from 'mongoose'
import { dailyCreatedConfig } from './aggregations'
import { fixAggregation } from './fixAggregations'

export async function getTodorant() {
  const connection = await createConnection(process.env.TODORANT, {
    useNewUrlParser: true,
  })

  const Todo = connection.collection('Todo')
  const User = connection.collection('User')

  const todoDaily = await Todo.aggregate(dailyCreatedConfig).toArray()
  const todoCount = await Todo.find().count()
  const userDaily = await User.aggregate(dailyCreatedConfig).toArray()
  const userCount = await User.find().count()
  await connection.close()
  return {
    todoDaily: fixAggregation(
      todoDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ),
    todoCount,
    userDaily: fixAggregation(
      userDaily.sort((a, b) => (a._id > b._id ? 1 : -1))
    ),
    userCount,
  }
}
