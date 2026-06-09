const fs = require('fs')
const { getConfig } = require('./config')
const { log } = require('./logger')

async function uploadVideo(webmPath, meta) {
  const { reitrnHubUrl, agentKey } = getConfig()
  const agentHeaders = { 'X-Agent-Key': agentKey }

  // 1. Get signed URL
  log(`Getting signed URL for ${meta.inspectionId}`)
  const signedUrlResp = await fetch(
    `${reitrnHubUrl}/api/storage/r2-signed-url?path=${encodeURIComponent(meta.storagePath)}`,
    { headers: agentHeaders }
  )
  if (!signedUrlResp.ok) {
    throw new Error(`Signed URL ${signedUrlResp.status}: ${await signedUrlResp.text()}`)
  }
  const { url: signedUrl } = await signedUrlResp.json()
  log(`Got signed URL for ${meta.inspectionId}`)

  // 2. Upload video buffer to R2
  log(`Uploading to R2: ${meta.inspectionId}`)
  const videoBuffer = fs.readFileSync(webmPath)
  const uploadResp = await fetch(signedUrl, {
    method: 'PUT',
    body: videoBuffer,
    headers: { 'Content-Type': 'video/webm' }
  })
  if (!uploadResp.ok) {
    throw new Error(`R2 PUT ${uploadResp.status}: ${await uploadResp.text()}`)
  }
  log(`R2 upload complete: ${meta.inspectionId}`)

  // 3. Mark uploaded in Firestore via reitrnhub
  const markResp = await fetch(`${reitrnHubUrl}/api/storage/mark-uploaded`, {
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
  })
  if (!markResp.ok) {
    throw new Error(`mark-uploaded ${markResp.status}: ${await markResp.text()}`)
  }
  log(`Marked uploaded: ${meta.inspectionId}`)
}

module.exports = { uploadVideo }
