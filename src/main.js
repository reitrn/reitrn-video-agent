const { app, Tray, Menu, BrowserWindow, ipcMain, shell, nativeImage, dialog } = require('electron')
const path = require('path')

// Single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// Lazy-loaded after app is ready
let config, watcher, logger

let tray = null
let setupWindow = null
let trayInterval = null

// ---------- icon ----------

function buildIcon() {
  // 16x16 solid indigo square (BGRA on Windows, RGBA elsewhere)
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    buf[i * 4 + 0] = 241 // B / R
    buf[i * 4 + 1] = 102 // G
    buf[i * 4 + 2] = 99  // R / B
    buf[i * 4 + 3] = 255 // A
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

// ---------- tray ----------

function setupTray() {
  tray = new Tray(buildIcon())
  updateTray()
  trayInterval = setInterval(updateTray, 3000)
}

function updateTray() {
  const { getQueueSize } = watcher
  const n = getQueueSize()
  const label = n === 0 ? 'Queue empty' : `${n} video${n !== 1 ? 's' : ''} uploading`
  tray.setToolTip(`reitrn Video Agent — ${label}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'reitrn Video Agent', enabled: false },
    { type: 'separator' },
    { label, enabled: false },
    { type: 'separator' },
    { label: 'Open log file', click: () => shell.openPath(logger.getLogPath()) },
    { label: 'Settings', click: showSetup },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]))
}

// ---------- setup window ----------

function showSetup() {
  if (setupWindow) { setupWindow.focus(); return }

  setupWindow = new BrowserWindow({
    width: 500,
    height: 340,
    resizable: false,
    maximizable: false,
    icon: buildIcon(),
    title: 'reitrn Video Agent — Settings',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  setupWindow.setMenu(null)
  setupWindow.loadFile(path.join(__dirname, '..', 'setup.html'))
  setupWindow.on('closed', () => { setupWindow = null })
}

// ---------- IPC ----------

ipcMain.handle('get-config', () => {
  const cfg = config.getConfig()
  return {
    watchFolder: cfg.watchFolder,
    reitrnHubUrl: cfg.reitrnHubUrl,
    agentKey: cfg.agentKey
  }
})

ipcMain.on('save-config', (_event, updates) => {
  config.setConfig({ ...updates, firstRun: false })
  if (setupWindow) setupWindow.close()

  // Restart watcher with new folder if agent is already running
  if (tray) {
    watcher.startWatcher()
  } else {
    startAgent()
  }
})

// ---------- startup ----------

function startAgent() {
  config = require('./config')
  watcher = require('./watcher')
  logger = require('./logger')

  logger.log('Agent starting')
  watcher.startWatcher()
  setupTray()
}

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true })

  // Load config module early (needs app to be ready for getPath)
  config = require('./config')
  watcher = require('./watcher')
  logger = require('./logger')

  if (config.getConfig().firstRun) {
    showSetup()
  } else {
    startAgent()
  }
})

// Keep running in tray — don't quit when windows close
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  if (trayInterval) clearInterval(trayInterval)
})
