const fs = require('fs')
const { net } = require('electron')
const { getConfig } = require('./config')
const { log } = require('./logger')

async function uploadVideo(webmPath, meta) {
  const { reitrnHubUrl, agentKey } = getConfig()
  const headers = { 'X-Agent-Key': agentKey }

  // 1. Get signed URL
  const signedUrlResp = await net.fetch(
    `${reitrnHubUrl}/api/storage/r2-signed-url?path=${encodeURIComponent(meta.storagePath)}`,
    { headers }
  )
  if (!signedUrlResp.ok) {
    throw new Error(`Signed URL ${signedUrlResp.status}: ${await signedUrlResp.text()}`)
  }
  const { url: signedUrl } = await signedUrlResp.json()

  // 2. Stream video to R2 via signed URL
  const stat = fs.statSync(webmPath)
  const videoStream = fs.createReadStream(webmPath)

  const uploadResp = await net.fetch(signedUrl, {
    method: 'PUT',
    body: videoStream,
    headers: {
      'Content-Type': 'video/webm',
      'Content-Length': String(stat.size)
    },
    duplex: 'half'
  })
  if (!uploadResp.ok) {
    throw new Error(`R2 PUT ${uploadResp.status}: ${await uploadResp.text()}`)
  }

  // 3. Mark uploaded in Firestore via reitrnhub
  const markResp = await net.fetch(`${reitrnHubUrl}/api/storage/mark-uploaded`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
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
