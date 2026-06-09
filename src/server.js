const https = require('https')
const fs = require('fs')
const path = require('path')
const busboy = require('busboy')
const { getConfig } = require('./config')
const { log } = require('./logger')

const PORT = 3011

// Certs bundled with the video agent installer — self-contained, no print agent dependency
const CERT_DIR = path.join(__dirname, '..', 'assets')

function startServer() {
  let tls
  try {
    tls = {
      cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')),
      key: fs.readFileSync(path.join(CERT_DIR, 'key.pem'))
    }
  } catch (err) {
    log(`WARNING: Could not load TLS cert (${err.message})`)
    return
  }

  const server = https.createServer(tls, handleRequest)

  server.listen(PORT, '0.0.0.0', () => {
    log(`Local server listening on https://local.reitrn.com:${PORT}`)
  })

  server.on('error', err => {
    log(`Local server error: ${err.message}`)
  })

  return server
}

function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (req.method === 'POST' && req.url === '/queue-video') {
    handleQueueVideo(req, res)
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'Not found' }))
}

function handleQueueVideo(req, res) {
  const { watchFolder } = getConfig()
  const bb = busboy({ headers: req.headers, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }) // 2GB limit

  let sidecarData = null
  let videoFilename = null
  let videoWriteStream = null
  let videoSavePath = null
  let fileError = null

  bb.on('field', (name, value) => {
    if (name === 'sidecar') {
      try {
        sidecarData = JSON.parse(value)
      } catch {
        fileError = 'Invalid sidecar JSON'
      }
    }
  })

  bb.on('file', (name, stream, info) => {
    if (name !== 'video') { stream.resume(); return }

    videoFilename = info.filename
    videoSavePath = path.join(watchFolder, videoFilename)
    videoWriteStream = fs.createWriteStream(videoSavePath)

    stream.pipe(videoWriteStream)

    stream.on('error', err => {
      fileError = err.message
    })
  })

  bb.on('finish', () => {
    if (fileError) {
      log(`queue-video error: ${fileError}`)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: fileError }))
      return
    }

    if (!sidecarData || !videoSavePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Missing sidecar or video' }))
      return
    }

    // Write sidecar JSON alongside the video
    const sidecarFilename = videoFilename.replace(/\.webm$/, '.json')
    const sidecarPath = path.join(watchFolder, sidecarFilename)

    try {
      fs.writeFileSync(sidecarPath, JSON.stringify(sidecarData, null, 2))
    } catch (err) {
      log(`Failed to write sidecar: ${err.message}`)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Failed to write sidecar' }))
      return
    }

    log(`Queued: ${sidecarData.inspectionId} (${videoFilename})`)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })

  bb.on('error', err => {
    log(`Multipart parse error: ${err.message}`)
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: err.message }))
  })

  req.pipe(bb)
}

module.exports = { startServer }
