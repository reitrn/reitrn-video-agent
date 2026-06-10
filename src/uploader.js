const fs = require('fs')
const { getConfig } = require('./config')
const { log } = require('./logger')

function withTimeout(promise, ms, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return promise
    .then(v => { clearTimeout(timer); return v })
    .catch(err => { clearTimeout(timer); throw new Error(`${label} timed out after ${ms / 1000}s`) })
}

async function uploadVideo(webmPath, meta) {
  const { reitrnHubUrl, agentKey } = getConfig()
  const agentHeaders = { 'X-Agent-Key': agentKey }

  // 1. Get signed URL (30s timeout)
  log(`Getting signed URL for ${meta.inspectionId}`)
  const signedUrlResp = await withTimeout(
    fetch(`${reitrnHubUrl}/api/storage/r2-signed-url?path=${encodeURIComponent(meta.storagePath)}`, { headers: agentHeaders }),
    30_000, 'signed-url'
  )
  if (!signedUrlResp.ok) {
    throw new Error(`Signed URL ${signedUrlResp.status}: ${await signedUrlResp.text()}`)
  }
  const { url: signedUrl } = await signedUrlResp.json()
  log(`Got signed URL for ${meta.inspectionId}`)

  // 2. Upload video buffer to R2 (10 minute timeout — large files on slow connections)
  log(`Uploading to R2: ${meta.inspectionId}`)
  const videoBuffer = fs.readFileSync(webmPath)
  const uploadResp = await withTimeout(
    fetch(signedUrl, { method: 'PUT', body: videoBuffer, headers: { 'Content-Type': 'video/webm' } }),
    10 * 60_000, 'r2-upload'
  )
  if (!uploadResp.ok) {
    throw new Error(`R2 PUT ${uploadResp.status}: ${await uploadResp.text()}`)
  }
  log(`R2 upload complete: ${meta.inspectionId}`)

  // 3. Mark uploaded in Firestore via reitrnhub (30s timeout)
  const markResp = await withTimeout(
    fetch(`${reitrnHubUrl}/api/storage/mark-uploaded`, {
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
    }),
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
  const signedUrlResp = await withTimeout(
    fetch(`${reitrnHubUrl}/api/storage/r2-signed-url?path=${encodeURIComponent(storagePath)}`, { headers: agentHeaders }),
    30_000, 'signed-url'
  )
  if (!signedUrlResp.ok) throw new Error(`Signed URL ${signedUrlResp.status}: ${await signedUrlResp.text()}`)
  const { url: signedUrl } = await signedUrlResp.json()

  // 2. Upload to R2 (10 minute timeout)
  const videoBuffer = fs.readFileSync(webmPath)
  const uploadResp = await withTimeout(
    fetch(signedUrl, { method: 'PUT', body: videoBuffer, headers: { 'Content-Type': 'video/webm' } }),
    10 * 60_000, 'r2-upload'
  )
  if (!uploadResp.ok) throw new Error(`R2 PUT ${uploadResp.status}`)
  // No mark-uploaded step — no metadata available, video saved under orphaned/
}

module.exports = { uploadVideo, uploadOrphanedVideo }
