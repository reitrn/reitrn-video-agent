const fs = require('fs')
const path = require('path')
const chokidar = require('chokidar')
const { getConfig } = require('./config')
const { uploadVideo } = require('./uploader')
const { log } = require('./logger')

const CONCURRENCY = 2
const MAX_RETRIES = 5

let activeUploads = 0
let queueSize = 0
const pending = []
const inFlight = new Set()

function getQueueSize() { return queueSize }

// ---------- queue ----------

function enqueue(jsonPath) {
  if (inFlight.has(jsonPath)) return
  inFlight.add(jsonPath)
  queueSize++
  pending.push(jsonPath)
  drain()
}

function drain() {
  while (activeUploads < CONCURRENCY && pending.length > 0) {
    const jsonPath = pending.shift()
    activeUploads++
    processFile(jsonPath).finally(() => {
      activeUploads--
      drain()
    })
  }
}

// ---------- processing ----------

async function processFile(jsonPath) {
  const webmPath = jsonPath.replace(/\.json$/, '.webm')

  if (!fs.existsSync(webmPath)) {
    log(`Waiting for webm: ${path.basename(webmPath)}`)
    await waitForFile(webmPath, 30_000)
    if (!fs.existsSync(webmPath)) {
      log(`ERROR: webm never appeared for ${path.basename(jsonPath)}, skipping`)
      inFlight.delete(jsonPath)
      queueSize--
      return
    }
  }

  let meta
  try {
    meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  } catch (err) {
    log(`ERROR: bad sidecar ${path.basename(jsonPath)}: ${err.message}`)
    inFlight.delete(jsonPath)
    queueSize--
    return
  }

  log(`Uploading ${meta.inspectionId} (${formatBytes(fs.statSync(webmPath).size)})`)

  const ok = await uploadWithRetry(webmPath, meta)
  if (ok) {
    try { fs.unlinkSync(webmPath) } catch {}
    try { fs.unlinkSync(jsonPath) } catch {}
    log(`Done: ${meta.inspectionId}`)
  }

  inFlight.delete(jsonPath)
  queueSize--
}

async function uploadWithRetry(webmPath, meta, attempt = 0) {
  try {
    await uploadVideo(webmPath, meta)
    return true
  } catch (err) {
    if (attempt >= MAX_RETRIES) {
      log(`FAILED ${meta.inspectionId} after ${MAX_RETRIES} retries: ${err.message}`)
      return false
    }
    const delay = Math.min(1000 * 2 ** attempt, 30_000)
    log(`Retry ${attempt + 1}/${MAX_RETRIES} for ${meta.inspectionId} in ${delay / 1000}s — ${err.message}`)
    await sleep(delay)
    return uploadWithRetry(webmPath, meta, attempt + 1)
  }
}

// ---------- watcher ----------

function startWatcher() {
  const { watchFolder } = getConfig()

  if (!fs.existsSync(watchFolder)) {
    fs.mkdirSync(watchFolder, { recursive: true })
  }

  log(`Watching: ${watchFolder}`)

  chokidar
    .watch(path.join(watchFolder, '*.json'), {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 }
    })
    .on('add', enqueue)
    .on('error', err => log(`Watcher error: ${err.message}`))
}

// ---------- helpers ----------

function waitForFile(filePath, timeoutMs) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      if (fs.existsSync(filePath) || Date.now() >= deadline) return resolve()
      setTimeout(check, 1000)
    }
    setTimeout(check, 1000)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function formatBytes(n) {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)}MB`
  if (n > 1e3) return `${(n / 1e3).toFixed(0)}KB`
  return `${n}B`
}

module.exports = { startWatcher, getQueueSize }
