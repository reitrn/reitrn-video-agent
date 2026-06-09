const { app, Tray, Menu, shell } = require('electron')
const path = require('path')

// Single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const TRAY_ICON = path.join(__dirname, '..', 'assets', 'tray.ico')

let tray = null
let trayInterval = null
let watcher, logger

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true })

  watcher = require('./watcher')
  logger = require('./logger')

  logger.log('Agent starting')
  watcher.startWatcher()

  setupTray()
})

function setupTray() {
  tray = new Tray(TRAY_ICON)
  updateTray()
  trayInterval = setInterval(updateTray, 3000)
}

function updateTray() {
  const n = watcher.getQueueSize()
  const status = n === 0 ? 'Queue empty' : `${n} video${n !== 1 ? 's' : ''} uploading`
  tray.setToolTip(`reitrn Video Agent — ${status}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'reitrn Video Agent', enabled: false },
    { type: 'separator' },
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Open log file', click: () => shell.openPath(logger.getLogPath()) },
    { label: 'Open upload folder', click: () => shell.openPath('C:\\reitrn-uploads') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]))
}

app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  if (trayInterval) clearInterval(trayInterval)
})
