const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  writeResultAtomically,
} = require('../../dist/helpers/shadowCollection')

function result() {
  return {
    mode: 'shadow',
    published: false,
    generatedAt: '2026-09-17T00:00:00.000Z',
    durationSeconds: 1,
    total: 42,
    components: { test: 42 },
    bots: {},
  }
}

describe('shadow result publishing', () => {
  const originalPath = process.env.STATS_SHADOW_RESULT_PATH

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.STATS_SHADOW_RESULT_PATH
    } else {
      process.env.STATS_SHADOW_RESULT_PATH = originalPath
    }
  })

  test('writes only to the configured shadow path', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-shadow-'))
    const outputPath = path.join(directory, 'latest.json')
    process.env.STATS_SHADOW_RESULT_PATH = outputPath

    writeResultAtomically(result())

    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toMatchObject({
      mode: 'shadow',
      published: false,
      total: 42,
    })
    expect(fs.existsSync(outputPath + '.tmp')).toBe(false)
  })

  test('refuses the production user-count path', () => {
    process.env.STATS_SHADOW_RESULT_PATH = '/tmp/usercount.txt'
    expect(() => writeResultAtomically(result())).toThrow(
      'Shadow output cannot target production usercount.txt'
    )
  })
})
