// Dependencies
import { Context } from 'koa'
import { Controller, Get } from 'koa-router-ts'
import { arr } from '../helpers/arr'
import { projectStats, summary } from '../helpers/summary'
import { stats } from '../helpers/stats'
import { userCount, userCountReachability } from '../helpers/userCount'

@Controller('/')
export default class {
  @Get('stats')
  stats(ctx: Context) {
    ctx.body = stats
  }

  @Get('summary')
  summary(ctx: Context) {
    ctx.body = summary()
  }

  @Get('stats/:project')
  projectStats(ctx: Context) {
    ctx.body = projectStats(ctx.params.project)
  }

  @Get('count')
  count(ctx: Context) {
    ctx.body = userCount
  }

  @Get('reachability')
  reachability(ctx: Context) {
    ctx.body = userCountReachability
  }

  @Get('arr')
  async arr(ctx: Context) {
    ctx.body = await arr()
  }
}
