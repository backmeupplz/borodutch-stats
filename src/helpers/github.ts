import axios from 'axios'

// Site project code → its open-source repos (same owner/name on GitHub and Forgejo)
export const projectRepos: { [code: string]: string[] } = {
  veydrift: ['Borodutch/veydrift'],
  tugport: ['backmeupplz/tugport'],
  plainwallet: ['backmeupplz/plainwallet'],
  plain: ['backmeupplz/plain'],
  quilcast: ['backmeupplz/quilcast'],
  agentboard: ['backmeupplz/agentboard'],
  absplus: ['backmeupplz/absplus'],
  meshplus: ['backmeupplz/meshtastic-plus'],
  vancouver: ['backmeupplz/vancouver'],
  voicy: ['backmeupplz/voicy'],
  myground: ['backmeupplz/myground'],
  banofbot: ['backmeupplz/banofbot'],
  randy: ['backmeupplz/randymbot'],
  videoDownloadBot: ['Borodutch/VideoDownloadBot'],
  todorant: [
    'backmeupplz/todorant',
    'backmeupplz/todorant-frontend',
    'backmeupplz/todorant-backend',
    'backmeupplz/todorant-rn',
  ],
  shieldy: ['1inch/shieldy'],
  borodutch: ['backmeupplz/borodutch', 'backmeupplz/borodutch-stats'],
  temply: ['backmeupplz/temply'],
}

// Registry packages, counted as the project's downloads too
const packages: { [code: string]: { npm?: string; crate?: string } } = {
  plain: { npm: 'plain-evm', crate: 'plain-evm' },
}

const github = axios.create({
  baseURL: 'https://api.github.com',
  timeout: 15000,
  headers: process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {},
})

async function allPages<T>(size: number, get: (page: number) => Promise<T[]>) {
  const result: T[] = []
  for (let page = 1; ; page++) {
    const items = await get(page)
    result.push(...items)
    if (items.length < size) return result
  }
}

type Release = { assets: { download_count: number }[] }
const assetDownloads = (releases: Release[]) =>
  releases.reduce(
    (sum, r) => sum + r.assets.reduce((s, a) => s + a.download_count, 0),
    0
  )

async function releaseDownloads(repo: string) {
  const [fromGithub, fromForgejo] = await Promise.all([
    allPages<Release>(
      100,
      async (page) =>
        (
          await github.get(`/repos/${repo}/releases?per_page=100&page=${page}`)
        ).data
    ),
    allPages<Release>(
      50,
      async (page) =>
        (
          await axios.get(
            `https://git.borodutch.com/api/v1/repos/${repo}/releases?limit=50&page=${page}`,
            { timeout: 15000 }
          )
        ).data
    ).catch(() => [] as Release[]),
  ])
  return assetDownloads(fromGithub) + assetDownloads(fromForgejo)
}

async function packageDownloads({
  npm,
  crate,
}: {
  npm?: string
  crate?: string
}) {
  let total = 0
  if (npm) {
    const today = new Date().toISOString().slice(0, 10)
    const { downloads } = (
      await axios.get(
        `https://api.npmjs.org/downloads/range/2015-01-10:${today}/${npm}`,
        { timeout: 15000 }
      )
    ).data
    total += downloads.reduce((s: number, d: any) => s + d.downloads, 0)
  }
  if (crate) {
    total += (
      await axios.get(`https://crates.io/api/v1/crates/${crate}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'borodutch-stats (borodutch.com)' },
      })
    ).data.crate.downloads
  }
  return total
}

export type GithubStats = {
  updatedAt: number
  stars: number
  repos: number
  downloads: number
  projects: { [code: string]: { stars: number; downloads: number } }
}

// ponytail: ~20 unauthenticated GitHub calls per refresh, so refresh every 6 h to stay far under the shared IP's
// 60/h; set GITHUB_TOKEN to refresh faster
const refreshEvery = 6 * 60 * 60 * 1000

export async function getGithub(previous?: GithubStats): Promise<GithubStats> {
  if (previous && Date.now() - previous.updatedAt < refreshEvery) {
    return previous
  }

  const repos = (
    await Promise.all(
      ['users/backmeupplz', 'orgs/Borodutch'].map((owner) =>
        allPages<any>(
          100,
          async (page) =>
            (
              await github.get(`/${owner}/repos?per_page=100&page=${page}`)
            ).data
        )
      )
    )
  )
    .reduce((all, page) => all.concat(page), [])
    .filter((r) => !r.fork)
  const starsByRepo = new Map<string, number>(
    repos.map((r) => [r.full_name.toLowerCase(), r.stargazers_count])
  )

  const projects: GithubStats['projects'] = {}
  for (const code of Object.keys(projectRepos)) {
    let stars = 0
    let downloads = 0
    for (const repo of projectRepos[code]) {
      // Repos outside the two owners (Shieldy moved to 1inch) are fetched one by one
      stars +=
        starsByRepo.get(repo.toLowerCase()) ??
        (await github.get(`/repos/${repo}`)).data.stargazers_count
      downloads += await releaseDownloads(repo)
    }
    if (packages[code]) downloads += await packageDownloads(packages[code])
    projects[code] = { stars, downloads }
  }

  return {
    updatedAt: Date.now(),
    stars: repos.reduce((s, r) => s + r.stargazers_count, 0),
    repos: repos.length,
    downloads: Object.values(projects).reduce((s, p) => s + p.downloads, 0),
    projects,
  }
}
