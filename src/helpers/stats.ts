// Dependencies
import axios from 'axios'

export let stats: any = {}

async function updateStats() {
  console.info('Started updating')
  const start = new Date()

  // Voicy
  stats.voicy = {
    stats: (await axios.get('https://pay.voicybot.com/statsfornikita')).data,
    cloudflare: await cloudflareData('a2931825c44695714557a87d1ceb4699'),
  }
  // Mamkin Trade
  stats.mt = (await axios.get('https://backend.mamkin.trade/stats')).data
  // Fondu
  stats.fondu = await cloudflareData('1ec35cf14fe9fdcd97290a42af2deee8')
  // Arbeitbot
  stats.arbeitbot = {
    clouflare: await cloudflareData('23655bf636aed23a2311f10f64dbb00a'),
  }
  // Borodutch
  stats.borodutch = await cloudflareData('1f2511a68b81a60b7280ebbb3c61291d')
  // Please no
  stats.pleaseno = await cloudflareData('40a2eeccaffd2df433952dc4ac924dde')
  // Resetbot
  stats.resetbot = await cloudflareData('5310b8bd048921d0d433392061172c90')
  // Golden borodutch
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

  const end = new Date()
  console.info(
    `Finished updating in ${(end.getTime() - start.getTime()) / 1000}s`
  )
}

let updating = false
updateStats()
setTimeout(async () => {
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

async function cloudflareData(id: string) {
  const data = (await axios.get(
    `https://api.cloudflare.com/client/v4/zones/${id}/analytics/dashboard?since=-172800`,
    {
      headers: {
        'X-Auth-Key': process.env.CLOUDFLARE,
        'X-Auth-Email': 'backmeupplz@gmail.com',
      },
    }
  )).data
  const result = []
  for (const unit of data.result.timeseries) {
    result.push(unit.requests.all)
  }
  return result
}
