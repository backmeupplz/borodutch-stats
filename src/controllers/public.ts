// Dependencies
import { Context } from 'koa'
import { Controller, Get } from 'koa-router-ts'
import { stats } from '../helpers/stats'
import { userCount } from '../helpers/userCount'

@Controller('/')
export default class {
  @Get('stats')
  stats(ctx: Context) {
    ctx.body = stats
  }

  @Get('count')
  count(ctx: Context) {
    ctx.body = userCount
  }
}
