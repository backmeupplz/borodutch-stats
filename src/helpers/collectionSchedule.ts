import { spawn } from 'child_process'

export const dailyCollectionIntervalMs = 24 * 60 * 60 * 1000
export const failedCollectionRetryMs = 60 * 60 * 1000
// Node clamps longer timeouts to 1ms; wake and re-read the snapshot instead.
export const maximumTimerDelayMs = 2 ** 31 - 1

export function collectionDelay(publishedAt: string, now = Date.now()) {
  // Publications are written with Date#toISOString. Reject normalized calendar
  // dates (e.g. February 30) rather than trusting Date.parse alone.
  if (typeof publishedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(publishedAt)) {
    throw new Error('Invalid successful collection timestamp')
  }
  const completed = Date.parse(publishedAt)
  if (!Number.isFinite(completed) ||
      new Date(completed).toISOString() !== publishedAt || !Number.isFinite(now)) {
    throw new Error('Invalid successful collection timestamp')
  }
  // A future-dated last good result is never grounds for an early full scan.
  return Math.max(0, completed + dailyCollectionIntervalMs - now)
}

// flock's kernel lock belongs to a child kept alive through stdin. The lock
// file's inode is permanent: unlinking it could admit a second holder. The
// child exits on parent death (pipe EOF), releasing the lock even on SIGKILL.
// Production Nixpacks Linux has /bin/flock; macOS tests use Python's stdlib
// fcntl.flock, which has the same kernel-lock lifetime semantics.
export async function withCollectionLock<T>(path: string, collect: () => Promise<T>) {
  const pythonLock = 'import fcntl,sys\nf=open(sys.argv[1],"a+")\ntry:\n fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError:\n sys.exit(73)\nprint("READY",flush=True)\nsys.stdin.buffer.read()\n'
  const linux = process.platform === 'linux'
  const child = linux
    ? spawn('flock', ['-n', '-E', '73', path, 'sh', '-c', 'printf "READY\\n"; cat >/dev/null'],
      { stdio: ['pipe', 'pipe', 'inherit'] })
    : spawn('python3', ['-c', pythonLock, path],
      { stdio: ['pipe', 'pipe', 'inherit'] })

  let closed = false
  child.on('close', () => { closed = true })
  await new Promise<void>((resolve, reject) => {
    let ready = false
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (!ready && output.includes('READY\n')) {
        ready = true
        resolve()
      }
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (!ready) {
        const error: any = new Error(code === 73
          ? 'Daily collection is already in progress'
          : 'Could not acquire daily collection lock (exit ' + code + ')')
        if (code === 73) error.code = 'EEXIST'
        reject(error)
      }
    })
  })

  let releasing = false
  const died = () => {
    // A lost lock while JS collection continues is unsafe. Fail-stop rather
    // than let this process publish concurrently with another holder.
    if (!releasing) process.exit(1)
  }
  child.on('close', died)
  try {
    return await collect()
  } finally {
    releasing = true
    child.stdin.end()
    if (!closed) {
      await new Promise<void>(resolve => child.once('close', () => resolve()))
    }
  }
}
