// Dependencies
import { userCount } from './userCount'
import axios from 'axios'
import { getMT } from './mt'
import { getArbeitBot } from './arbeitbot'
import { getShieldy } from './shieldy'
import { getTemply } from './temply'
import { getRandym } from './randym'
import { getBanofbot } from './banofbot'
import { getTlgcoin } from './tlgcoin'
import { getTodorant } from './todorant'
import { getFeedr } from './feedr'
import { getCheckMyTextBot } from './checkMyTextBot'

export let stats: any = {}

async function updateStats() {
  console.info('Started updating')
  const start = new Date()

  // TLGCoin
  try {
    stats.tlgcoin = await getTlgcoin()
  } catch (err) {
    console.log(err)
  }
  // Banofbot
  try {
    stats.banofbot = await getBanofbot()
  } catch (err) {
    console.log(err)
  }
  // Randymbot
  try {
    stats.randym = await getRandym()
  } catch (err) {
    console.log(err)
  }
  // Temply
  try {
    stats.temply = await getTemply()
  } catch (err) {
    console.log(err)
  }
  // Shieldy
  try {
    stats.shieldy = await getShieldy()
  } catch (err) {
    console.log(err)
  }
  // Arbeitbot
  try {
    stats.arbeitbot = await getArbeitBot()
  } catch (err) {
    console.log(err)
  }
  // Mamkin Trade
  try {
    stats.mt = await getMT()
  } catch (err) {
    console.log(err)
  }
  // Voicy
  try {
    stats.voicy = {
      stats: (await axios.get('https://pay.voicybot.com/statsfornikita')).data,
      cloudflare: await cloudflareData(
        'a2931825c44695714557a87d1ceb4699',
        'voicy'
      ),
    }
  } catch (err) {
    console.log(err)
  }
  // Fondu
  try {
    stats.fondu = await cloudflareData(
      '1ec35cf14fe9fdcd97290a42af2deee8',
      'fondu'
    )
  } catch (err) {
    console.log(err)
  }
  // Borodutch
  try {
    stats.borodutch = await cloudflareData(
      '1f2511a68b81a60b7280ebbb3c61291d',
      'borodutch'
    )
  } catch (err) {
    console.log(err)
  }
  // Please no
  try {
    stats.pleaseno = await cloudflareData(
      '40a2eeccaffd2df433952dc4ac924dde',
      'pleaseno'
    )
  } catch (err) {
    console.log(err)
  }
  // Resetbot
  try {
    stats.resetbot = await cloudflareData(
      '5310b8bd048921d0d433392061172c90',
      'resetbot'
    )
  } catch (err) {
    console.log(err)
  }
  // Golden borodutch
  try {
    console.log('Getting @golden_borodutch data')
    const goldenBorodutch = (await axios.get('https://t.me/golden_borodutch'))
      .data
    stats.goldenBorodutch = {
      subCount: parseInt(
        /<div class="tgme_page_extra">(.+) members/
          .exec(goldenBorodutch)[1]
          .replace(' ', ''),
        10
      ),
    }
    console.log('Got @golden_borodutch data')
  } catch (err) {
    console.log(err)
  }
  // Todorant
  try {
    stats.todorant = {
      db: await getTodorant(),
      cloudflare: await cloudflareData(
        '04eee73f1a96a2ef34c12e1f79936104',
        'todorant'
      ),
    }
  } catch (err) {
    console.log(err)
  }
  // Feedr
  try {
    stats.feedr = {
      db: await getFeedr(),
      cloudflare: await cloudflareData(
        '103a52b4434392eb97931dba963a6653',
        'feedr'
      ),
    }
  } catch (err) {
    console.log(err)
  }
  // Check my text bot
  try {
    stats.checkMyTextBot = await getCheckMyTextBot()
  } catch (err) {
    console.log(err)
  }
  // User count
  stats.userCount = userCount

  const end = new Date()
  console.info(
    `Finished updating in ${(end.getTime() - start.getTime()) / 1000}s`
  )
}

let updating = false
updateStats()
setInterval(async () => {
  if (updating) {
    return
  }
  try {
    updating = true
    await updateStats()
  } catch (err) {
    console.error(err)
  } finally {
    updating = false
  }
}, 10 * 60 * 1000)

export async function cloudflareData(id: string, name: string) {
  try {
    console.log(`Getting Cloudflare data for ${id}`)
    const data = (
      await axios.get(
        `https://api.cloudflare.com/client/v4/zones/${id}/analytics/dashboard?since=-129600`,
        {
          headers: {
            'X-Auth-Key': process.env.CLOUDFLARE,
            'X-Auth-Email': 'backmeupplz@gmail.com',
          },
        }
      )
    ).data
    const result = []
    for (const unit of data.result.timeseries) {
      result.push(unit.requests.all)
    }
    console.log(`Got Cloudflare data for ${id}`)
    return result
  } catch (err) {
    console.log(err)
    return stats[name]
      ? Array.isArray(stats[name])
        ? stats[name]
        : stats[name].cloudflare || []
      : []
  }
}
