// Get environment variables
import * as dotenv from 'dotenv'
dotenv.config({ path: `${__dirname}/../.env` })
// Dependencies
import 'reflect-metadata'
import * as Koa from 'koa'
import bodyParser from 'koa-bodyparser-ts'
import { loadControllers } from 'koa-router-ts'
import * as cors from '@koa/cors'
import { gzipSync } from 'zlib'
import { startDailyCollection } from './helpers/userCount'

const app = new Koa()
const router = loadControllers(`${__dirname}/controllers`, { recurse: true })
const port = Number(process.env.PORT) || 1339

// Run app
app.use(cors({ origin: '*' }))
// Stats payloads are large JSON (up to ~600 KB) and compress ~10x
app.use(async (ctx, next) => {
  await next()
  ctx.vary('Accept-Encoding')
  if (
    !ctx.body ||
    typeof ctx.body !== 'object' ||
    Buffer.isBuffer(ctx.body) ||
    typeof ctx.body.pipe === 'function' ||
    ctx.acceptsEncodings('gzip', 'identity') !== 'gzip'
  ) {
    return
  }
  ctx.body = gzipSync(JSON.stringify(ctx.body))
  ctx.type = 'application/json'
  ctx.set('Content-Encoding', 'gzip')
})
app.use(bodyParser())
app.use(router.routes())
app.use(router.allowedMethods())
app.listen(port)
if (process.env.STATS_DAILY_COLLECTION_ENABLED === 'true') {
  startDailyCollection()
}

console.log(`Koa application is up and running on port ${port}`)
