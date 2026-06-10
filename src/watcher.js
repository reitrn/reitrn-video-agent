const fs = require('fs')
const path = require('path')
const chokidar = require('chokidar')
const { getConfig } = require('./config')
const { uploadVideo, uploadOrphanedVideo } = require('./uploader')
const { log } = require('./logger')

const CONCURRENCY = 2
const MAX_RETRIES = 5
const REQUEUE_DELAY_MS = 5 * 60_000 // re-enqueue failed files after 5 minutes
const ORPHAN_GRACE_MS = 60_000      // wait 60s for a .json before treating .webm as orphaned
const ORPHAN_SCAN_MS  = 2 * 60_000  // scan for orphans every 2 minutes

let activeUploads = 0
let queueSize = 0
const pending = []
const inFlight = new Set()
const orphanInFlight = new Set()

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
    inFlight.delete(jsonPath)
    queueSize--
  } else {
    // All retries exhausted — re-enqueue after 5 minutes so it tries again automatically
    log(`Re-queuing ${meta.inspectionId} in ${REQUEUE_DELAY_MS / 60_000} minutes`)
    inFlight.delete(jsonPath)
    queueSize--
    setTimeout(() => enqueue(jsonPath), REQUEUE_DELAY_MS)
  }
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

// ---------- orphan scanner ----------

function scanForOrphans() {
  const { watchFolder } = getConfig()
  let files
  try { files = fs.readdirSync(watchFolder) } catch { return }

  const jsonFiles = new Set(files.filter(f => f.endsWith('.json')))
  const webmFiles = files.filter(f => f.endsWith('.webm'))

  for (const webmFile of webmFiles) {
    const jsonFile = webmFile.replace(/\.webm$/, '.json')
    if (jsonFiles.has(jsonFile)) continue // normal flow will handle it

    const webmPath = path.join(watchFolder, webmFile)
    if (orphanInFlight.has(webmPath)) continue // already being processed

    // Only treat as orphaned if the file is older than the grace period
    try {
      const ageMs = Date.now() - fs.statSync(webmPath).mtimeMs
      if (ageMs < ORPHAN_GRACE_MS) continue
    } catch { continue }

    log(`Orphaned webm (no sidecar): ${webmFile} — uploading to orphaned/`)
    orphanInFlight.add(webmPath)
    processOrphan(webmPath)
  }
}

async function processOrphan(webmPath, attempt = 0) {
  try {
    await uploadOrphanedVideo(webmPath)
    try { fs.unlinkSync(webmPath) } catch {}
    log(`Orphaned upload done: ${path.basename(webmPath)}`)
  } catch (err) {
    if (attempt >= MAX_RETRIES) {
      log(`Orphaned upload FAILED after ${MAX_RETRIES} retries: ${path.basename(webmPath)} — ${err.message}`)
      orphanInFlight.delete(webmPath) // allow next scan to retry
      return
    }
    const delay = Math.min(1000 * 2 ** attempt, 30_000)
    log(`Orphaned retry ${attempt + 1}/${MAX_RETRIES} for ${path.basename(webmPath)} in ${delay / 1000}s`)
    await sleep(delay)
    await processOrphan(webmPath, attempt + 1)
  }
  orphanInFlight.delete(webmPath)
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

  // Scan for orphaned .webm files (no matching .json) on startup and periodically
  setTimeout(scanForOrphans, ORPHAN_GRACE_MS)
  setInterval(scanForOrphans, ORPHAN_SCAN_MS)
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
