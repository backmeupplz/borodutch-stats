// Dependencies
import { userCount, userCountSeparate } from './userCount'
import axios from 'axios'
import { getMT } from './mt'
import { getArbeitBot } from './arbeitbot'
import { getTemply } from './temply'
import { getRandym } from './randym'
import { getBanofbot } from './banofbot'
import { getTlgcoin } from './tlgcoin'
import { getTodorant } from './todorant'
import { getFeedr } from './feedr'
import { getCheckMyTextBot } from './checkMyTextBot'
import { getDeleteNudesBot } from './deleteNudesBot'

export let stats: any = {}

async function updateStats() {
  console.info('Started updating')
  const start = new Date()

  // Shieldy
  try {
    const shieldyStats = (await axios('http://142.93.135.209:1339/stats')).data
      .shieldy
    stats.shieldy = shieldyStats
  } catch (err) {
    console.log(err)
  }
  // DeleteNudesBot
  try {
    stats.deletenudesbot = await getDeleteNudesBot()
  } catch (err) {
    console.log(err)
  }
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
  // Bot finder
  try {
    stats.botfinder = await cloudflareData(
      '4418257b0d1bb3ba3d3beafb6834238f',
      'botfinder'
    )
  } catch (err) {
    console.log(err)
  }
  // Fix sleep
  try {
    stats.fixsleep = await cloudflareData(
      '5046fa978449269a5ede9bda4ca2cc9a',
      'fixsleep'
    )
  } catch (err) {
    console.log(err)
  }
  // Magic pill
  try {
    stats.magicpill = await cloudflareData(
      '48cef4a697e3a544873c5799d4bcd96f',
      'magicpill'
    )
  } catch (err) {
    console.log(err)
  }
  // CommonCrypto
  try {
    stats.commoncrypto = await cloudflareData(
      '178f8a0aed2199be0d4df9faf1bf708e',
      'commoncrypto'
    )
  } catch (err) {
    console.log(err)
  }
  // Localizer
  try {
    stats.localizer = await cloudflareData(
      '773399d49713f0a56c59800f0baf677f',
      'localizer'
    )
  } catch (err) {
    console.log(err)
  }
  // Post Your Startup
  try {
    stats.postyourstartup = await cloudflareData(
      '1eea2de74b3d26096fdfdc487b641ad0',
      'postyourstartup'
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
    const goldenBorodutchNumber = /<div class="tgme_page_extra">(.+) \D+/
      .exec(goldenBorodutch)[1]
      .replace(' ', '')
    console.log(goldenBorodutchNumber)
    stats.goldenBorodutch = {
      subCount: parseInt(goldenBorodutchNumber, 10),
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
  stats.userCountSeparate = userCountSeparate

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
    console.log(`Getting Cloudflare data for ${id} ${process.env.CLOUDFLARE}`)
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    const data = (
      await axios.post(
        `https://api.cloudflare.com/client/v4/graphql`,
        JSON.stringify({
          query: `{
viewer {
  zones(filter: {zoneTag: "${id}"}) {
    httpRequests1dGroups(orderBy: [date_ASC], limit: 1000, filter: {date_gt: "${threeMonthsAgo.getFullYear()}-${
            threeMonthsAgo.getMonth() + 1 > 9
              ? threeMonthsAgo.getMonth() + 1
              : `0${threeMonthsAgo.getMonth() + 1}`
          }-${
            threeMonthsAgo.getDate() > 9
              ? threeMonthsAgo.getDate()
              : `0${threeMonthsAgo.getDate()}`
          }"}) {
      date: dimensions {
        date
      }
      sum {
        requests
      }
    }
  }
}
}`,
          variables: {},
        }),
        {
          headers: {
            'X-Auth-Key': process.env.CLOUDFLARE,
            'X-AUTH-EMAIL': 'backmeupplz@gmail.com',
          },
        }
      )
    ).data
    const result = []
    for (const unit of data.data.viewer.zones[0].httpRequests1dGroups) {
      result.push(unit.sum.requests)
    }
    console.log(`Got Cloudflare data for ${id}`)
    return result
  } catch (err) {
    console.log(err.message)
    return stats[name]
      ? Array.isArray(stats[name])
        ? stats[name]
        : stats[name].cloudflare || stats[name].website || []
      : []
  }
}
