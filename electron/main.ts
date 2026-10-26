import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { PROVIDERS } from '../src/lib/ai/providers'
import type { AiBridgeRequest } from '../src/lib/ai/bridge'
import { cancelRequest, proxyRequest } from './aiProxy'
import { clearKey, keyStatus, setKey, vaultEncryption } from './vault'

const isDev = !app.isPackaged && !!process.env.ELECTRON_DEV
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
const RENDERER_DIST = path.join(__dirname, '..', '..', 'dist')

let mainWindow: BrowserWindow | null = null

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function readState(): WindowState {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8')
    const parsed = JSON.parse(raw) as WindowState
    if (parsed.width > 400 && parsed.height > 300) return parsed
  } catch {
    /* defaults */
  }
  return { width: 1440, height: 940 }
}

function saveState(win: BrowserWindow) {
  if (!win || win.isDestroyed() || win.isMinimized()) return
  const bounds = win.getNormalBounds()
  const state: WindowState = { ...bounds, maximized: win.isMaximized() }
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state))
  } catch {
    /* not fatal */
  }
}

function createWindow() {
  const state = readState()
  nativeTheme.themeSource = 'dark'

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0908',
    title: 'Insta Buddy',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: true,
    },
  })

  if (state.maximized) mainWindow.maximize()

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? DEV_URL : `file://${RENDERER_DIST}`
    if (!url.startsWith(allowed)) {
      event.preventDefault()
      if (/^https:\/\//.test(url)) void shell.openExternal(url)
    }
  })

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (isDev) {
    void mainWindow.loadURL(DEV_URL)
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  mainWindow.on('close', () => {
    if (mainWindow) saveState(mainWindow)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** Lock things down: our own bundled assets, images, and https/api calls only. */
function applyContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const devExtras = isDev ? " 'unsafe-inline' 'unsafe-eval' http://localhost:5173 ws://localhost:5173" : ''
    const csp = [
      "default-src 'self'",
      `script-src 'self'${devExtras}`,
      `style-src 'self' 'unsafe-inline'${devExtras}`,
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self'${devExtras} https: http://127.0.0.1:* http://localhost:*`,
      "media-src 'self' blob: data:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ].join('; ')
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
  // the renderer needs no camera/mic/geolocation — clipboard is handled by the OS
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

function send(channel: string) {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  win?.webContents.send(channel)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('menu:settings') },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Add photos…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open-photos') },
        { label: 'Export dump…', accelerator: 'CmdOrCtrl+E', click: () => send('menu:export') },
        { type: 'separator' },
        ...(isMac ? [] : [{ label: 'Settings…', accelerator: 'Ctrl+,', click: () => send('menu:settings') }]),
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Review', accelerator: 'CmdOrCtrl+1', click: () => send('menu:review') },
        { label: 'Compose', accelerator: 'CmdOrCtrl+2', click: () => send('menu:compose') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' as const }] : [])],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Insta Buddy on GitHub', click: () => void shell.openExternal('https://github.com/sarang-cmd/insta-buddy') },
        ...PROVIDERS.slice(0, 4).map((p) => ({
          label: `${p.name} API keys`,
          click: () => void shell.openExternal(p.keyUrl ?? 'https://github.com/sarang-cmd/insta-buddy'),
        })),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ------------------------------------------------------------------- IPC */

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  platform: process.platform,
  userData: app.getPath('userData'),
}))

ipcMain.handle('ai:status', () => ({
  providers: keyStatus(PROVIDERS.map((p) => p.id)),
  encryption: vaultEncryption(),
}))

ipcMain.handle('ai:setKey', (_event, providerId: string, key: string) => {
  if (!PROVIDERS.some((p) => p.id === providerId)) return { ok: false, error: 'Unknown provider' }
  if (typeof key !== 'string' || key.length > 4096) return { ok: false, error: 'That key looks wrong.' }
  try {
    return setKey(providerId, key)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save the key.' }
  }
})

ipcMain.handle('ai:clearKey', (_event, providerId: string) => clearKey(providerId))

ipcMain.handle('ai:request', async (_event, payload: AiBridgeRequest) => proxyRequest(payload))
ipcMain.handle('ai:cancel', () => cancelRequest())

ipcMain.handle('files:openImages', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  const result = await dialog.showOpenDialog(win!, {
    title: 'Add photos',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif'] }],
  })
  if (result.canceled) return []
  return result.filePaths
    .map((filePath) => {
      try {
        const data = fs.readFileSync(filePath)
        const stat = fs.statSync(filePath)
        const ext = path.extname(filePath).toLowerCase()
        const type =
          ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.heic' || ext === '.heif' ? 'image/heic' : 'image/jpeg'
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
        return { name: path.basename(filePath), type, lastModified: stat.mtimeMs, data: buffer }
      } catch {
        return null
      }
    })
    .filter((f): f is { name: string; type: string; lastModified: number; data: ArrayBuffer } => !!f)
})

ipcMain.handle('files:saveFile', async (_event, name: string, data: ArrayBuffer) => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  const ext = path.extname(name).replace('.', '') || 'bin'
  const result = await dialog.showSaveDialog(win!, {
    title: 'Save',
    defaultPath: path.join(app.getPath('downloads'), path.basename(name)),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  })
  if (result.canceled || !result.filePath) return { saved: false }
  try {
    fs.writeFileSync(result.filePath, Buffer.from(data))
    return { saved: true, path: result.filePath }
  } catch (err) {
    return { saved: false, path: err instanceof Error ? err.message : undefined }
  }
})

ipcMain.handle('shell:openExternal', (_event, url: string) => {
  if (!/^https:\/\//.test(url)) return { ok: false }
  void shell.openExternal(url)
  return { ok: true }
})

/* ------------------------------------------------------------- lifecycle */

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: 'Insta Buddy',
      applicationVersion: app.getVersion(),
      credits: 'Photos stay on your device. Optional AI features call the provider you choose.',
    })
    applyContentSecurityPolicy()
    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
