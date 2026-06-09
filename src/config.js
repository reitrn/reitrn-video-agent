// All values are baked in at build time — no per-machine configuration needed.
// Update REITRN_HUB_URL here before building if the domain changes.
const CONFIG = {
  watchFolder: 'C:\\reitrn-uploads',
  reitrnHubUrl: 'https://hub.reitrn.com',
  agentKey: 'a7f3c2e1-9b84-4d56-8e20-f1c3b5a72d90'
}

function getConfig() { return CONFIG }

module.exports = { getConfig }
