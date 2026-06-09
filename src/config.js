const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const DEFAULTS = {
  watchFolder: 'C:\\reitrn-uploads',
  reitrnHubUrl: 'https://hub.reitrn.com',
  agentKey: 'a7f3c2e1-9b84-4d56-8e20-f1c3b5a72d90',
  firstRun: true
}

let cache = null

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function getConfig() {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

function setConfig(updates) {
  cache = { ...getConfig(), ...updates }
  fs.writeFileSync(configPath(), JSON.stringify(cache, null, 2))
}

module.exports = { getConfig, setConfig }
