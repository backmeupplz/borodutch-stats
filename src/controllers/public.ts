// Dependencies
import { Context } from 'koa'
import { Controller, Get } from 'koa-router-ts'
import { stats } from '../helpers/stats'

@Controller('/')
export default class {
  @Get('stats')
  stats(ctx: Context) {
    ctx.body = stats
  }
}
