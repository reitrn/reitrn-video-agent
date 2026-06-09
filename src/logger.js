const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const MAX_LOG_BYTES = 5 * 1024 * 1024 // 5MB

let _logPath = null

function getLogPath() {
  if (!_logPath) _logPath = path.join(app.getPath('userData'), 'agent.log')
  return _logPath
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  process.stdout.write(line)
  try {
    const p = getLogPath()
    // Rotate if over 5MB
    try {
      if (fs.statSync(p).size > MAX_LOG_BYTES) fs.renameSync(p, p + '.old')
    } catch {}
    fs.appendFileSync(p, line)
  } catch {}
}

module.exports = { log, getLogPath }
