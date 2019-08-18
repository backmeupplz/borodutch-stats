// Dependencies
import axios from 'axios'
import { createConnection } from 'mongoose'
import { dailyCreatedConfig } from './aggregations'

export async function getTodorant() {
  const connection = await createConnection(process.env.TODORANT, {
    useNewUrlParser: true,
  })

  const Todo = connection.model('Todo', {} as any)
  const User = connection.model('User', {} as any)

  const todoDaily = await Todo.aggregate(dailyCreatedConfig)
  const todoCount = await Todo.find().countDocuments()
  const userDaily = await User.aggregate(dailyCreatedConfig)
  const userCount = await User.find().countDocuments()
  await connection.close()
  return {
    todoDaily: todoDaily.sort((a, b) => (a._id > b._id ? 1 : -1)),
    todoCount,
    userDaily: userDaily.sort((a, b) => (a._id > b._id ? 1 : -1)),
    userCount,
  }
}
