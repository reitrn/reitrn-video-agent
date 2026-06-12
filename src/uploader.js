const fs = require('fs')
const https = require('https')
const { getConfig } = require('./config')
const { log } = require('./logger')

const STALL_TIMEOUT_MS = 2 * 60_000  // abort only if no bytes move for 2 min
const MAX_UPLOAD_MS = 60 * 60_000    // absolute safety cap per attempt

async function fetchWithTimeout(url, options, ms, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`${label} timed out after ${ms / 1000}s`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Streamed PUT via https.request — Node's fetch enforces a hidden 5-minute
// headersTimeout, and R2 only sends headers after the whole body arrives, so
// large files on the warehouse uplink could never finish. Stall-based abort
// lets a slow-but-progressing upload run to completion.
function putFileToR2(signedUrl, filePath) {
  return new Promise((resolve, reject) => {
    const u = new URL(signedUrl)
    const size = fs.statSync(filePath).size

    let stallTimer, capTimer, settled = false
    const cleanup = () => { clearTimeout(stallTimer); clearTimeout(capTimer) }
    const fail = err => {
      if (settled) return
      settled = true
      cleanup()
      req.destroy()
      reject(err)
    }
    const resetStall = () => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(
        () => fail(new Error(`r2-upload stalled — no data sent for ${STALL_TIMEOUT_MS / 1000}s`)),
        STALL_TIMEOUT_MS
      )
    }

    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'PUT',
      headers: { 'Content-Type': 'video/webm', 'Content-Length': size }
    }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        if (settled) return
        settled = true
        cleanup()
        if (res.statusCode >= 200 && res.statusCode < 300) resolve()
        else reject(new Error(`R2 PUT ${res.statusCode}: ${body.slice(0, 200)}`))
      })
    })

    capTimer = setTimeout(
      () => fail(new Error(`r2-upload exceeded ${MAX_UPLOAD_MS / 60_000} min cap`)),
      MAX_UPLOAD_MS
    )
    resetStall()

    const stream = fs.createReadStream(filePath)
    stream.on('data', resetStall)
    stream.on('error', err => fail(new Error(`read error: ${err.message}`)))
    req.on('error', err => fail(err))
    stream.pipe(req)
  })
}

async function uploadVideo(webmPath, meta) {
  const { reitrnHubUrl, agentKey } = getConfig()
  const agentHeaders = { 'X-Agent-Key': agentKey }

  // 1. Get signed URL (30s timeout)
  log(`Getting signed URL for ${meta.inspectionId}`)
  const signedUrlResp = await fetchWithTimeout(
    `${reitrnHubUrl}/api/storage/r2-signed-url?path=${encodeURIComponent(meta.storagePath)}`,
    { headers: agentHeaders },
    30_000, 'signed-url'
  )
  if (!signedUrlResp.ok) {
    throw new Error(`Signed URL ${signedUrlResp.status}: ${await signedUrlResp.text()}`)
  }
  const { url: signedUrl } = await signedUrlResp.json()
  log(`Got signed URL for ${meta.inspectionId}`)

  // 2. Stream video to R2 (stall-based timeout — see putFileToR2)
  log(`Uploading to R2: ${meta.inspectionId}`)
  await putFileToR2(signedUrl, webmPath)
  log(`R2 upload complete: ${meta.inspectionId}`)

  // 3. Mark uploaded in Firestore via reitrnhub (30s timeout)
  const markResp = await fetchWithTimeout(
    `${reitrnHubUrl}/api/storage/mark-uploaded`,
    {
      method: 'POST',
      headers: { ...agentHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectionId: meta.inspectionId,
        collectionPath: meta.collectionPath,
        sessionId: meta.sessionId,
        staffName: meta.staffName,
        videoStartedAt: meta.videoStartedAt,
        storagePath: meta.storagePath
      })
    },
    30_000, 'mark-uploaded'
  )
  if (!markResp.ok) {
    throw new Error(`mark-uploaded ${markResp.status}: ${await markResp.text()}`)
  }
  log(`Marked uploaded: ${meta.inspectionId}`)
}

async function uploadOrphanedVideo(webmPath) {
  const { reitrnHubUrl, agentKey } = getConfig()
  const agentHeaders = { 'X-Agent-Key': agentKey }
  const filename = require('path').basename(webmPath)
  const storagePath = `orphaned/${filename}`

  // 1. Get signed URL (30s timeout)
  const signedUrlResp = await fetchWithTimeout(
    `${reitrnHubUrl}/api/storage/r2-signed-url?path=${encodeURIComponent(storagePath)}`,
    { headers: agentHeaders },
    30_000, 'signed-url'
  )
  if (!signedUrlResp.ok) throw new Error(`Signed URL ${signedUrlResp.status}: ${await signedUrlResp.text()}`)
  const { url: signedUrl } = await signedUrlResp.json()

  // 2. Stream to R2 (stall-based timeout)
  await putFileToR2(signedUrl, webmPath)
  // No mark-uploaded step — no metadata available, video saved under orphaned/
}

module.exports = { uploadVideo, uploadOrphanedVideo }
