/**
 * Runs the real electron/dist/main.cjs against a mocked `electron` module.
 * Verifies window security, CSP, IPC handlers, the encrypted key vault and the
 * AI proxy (key injection, https enforcement, retries, error mapping).
 * Requires `npm run electron:build` first.
 */
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-'))
let failures = 0
const check = (cond, label, extra) => {
  if (!cond) {
    failures++
    console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra))
  } else console.log('ok  ', label)
}

const handlers = new Map()
const windows = []
let headersCallback = null
let menuTemplate = null
const openedExternal = []
let permissionHandler = null

class FakeWebContents {
  on() {}
  setWindowOpenHandler(h) {
    this.windowOpenHandler = h
  }
  send() {}
}
class FakeBrowserWindow {
  constructor(opts) {
    this.opts = opts
    this.webContents = new FakeWebContents()
    this.bounds = { x: 0, y: 0, width: opts.width, height: opts.height }
    windows.push(this)
  }
  static getFocusedWindow() {
    return windows[windows.length - 1] ?? null
  }
  static getAllWindows() {
    return windows
  }
  once(event, cb) {
    if (event === 'ready-to-show') this.readyCb = cb
  }
  on() {}
  loadURL(url) {
    this.loadedUrl = url
    return Promise.resolve()
  }
  loadFile(file) {
    this.loadedFile = file
    return Promise.resolve()
  }
  isDestroyed() {
    return false
  }
  isMinimized() {
    return false
  }
  maximize() {
    this.maximized = true
  }
  focus() {}
  restore() {}
  show() {
    this.shown = true
  }
  getNormalBounds() {
    return this.bounds
  }
  isMaximized() {
    return !!this.maximized
  }
}

const fakeElectron = {
  app: {
    name: 'Insta Buddy',
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on() {},
    quit() {},
    getVersion: () => '0.1.0',
    getPath: (key) => (key === 'userData' ? path.join(tmp, 'userData') : tmp),
    setAboutPanelOptions() {},
  },
  BrowserWindow: FakeBrowserWindow,
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(tmp, 'a.jpg'), path.join(tmp, 'b.png')] }),
    showSaveDialog: async () => ({ canceled: false, filePath: path.join(tmp, 'out.zip') }),
  },
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: (template) => (menuTemplate = template) },
  nativeTheme: { themeSource: 'system' },
  session: {
    defaultSession: {
      webRequest: { onHeadersReceived: (cb) => (headersCallback = cb) },
      setPermissionRequestHandler: (h) => (permissionHandler = h),
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => b.toString('utf8').replace(/^enc:/, ''),
  },
  shell: { openExternal: async (url) => openedExternal.push(url) },
}

const originalLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') return fakeElectron
  return originalLoad.apply(this, arguments)
}

fs.writeFileSync(path.join(tmp, 'a.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0x00]))
fs.writeFileSync(path.join(tmp, 'b.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

async function main() {
  require(path.join(__dirname, '..', 'electron/dist/main.cjs'))
  await new Promise((r) => setTimeout(r, 80))

  const win = windows[0]
  check(!!win, 'a window was created')
  const wp = win.opts.webPreferences
  check(wp.contextIsolation === true && wp.nodeIntegration === false && wp.sandbox === true, 'secure webPreferences')
  check(/dist[\\/]index\.html$/.test(win.loadedFile ?? ''), 'loads bundled index.html when packaged')
  win.readyCb?.()
  check(win.shown === true, 'window shows when ready')

  headersCallback({ responseHeaders: {} }, (res) => (headersCallback.responseHeaders = res.responseHeaders))
  const csp = String(headersCallback.responseHeaders['Content-Security-Policy'])
  check(csp.includes("default-src 'self'") && csp.includes("object-src 'none'"), 'CSP is restrictive')
  check(csp.includes('https:') && csp.includes('http://127.0.0.1:*'), 'CSP allows cloud + local providers')
  check(typeof permissionHandler === 'function', 'permission handler installed')
  check(Array.isArray(menuTemplate), 'application menu built')

  check(handlers.has('app:info') && handlers.has('ai:request') && handlers.has('files:saveFile'), 'IPC surface registered')
  const info = await handlers.get('app:info')()
  check(info.version === '0.1.0', 'app info payload')

  const status0 = await handlers.get('ai:status')()
  check(status0.encryption === 'os-keychain' && Object.keys(status0.providers).length === 12, 'vault status covers 12 providers')

  check((await handlers.get('ai:setKey')(null, 'openai', '  sk-secret-123  ')).ok, 'setKey ok')
  const vaultFile = path.join(tmp, 'userData', 'ai-keys.json')
  check(!fs.readFileSync(vaultFile, 'utf8').includes('sk-secret-123'), 'raw key never written to disk')
  // POSIX only: Windows has no Unix file modes, so writeFileSync({ mode }) and
  // chmodSync are no-ops there and this assertion could never hold. Assert what
  // each platform can actually guarantee about the vault file.
  const vaultMode = fs.statSync(vaultFile).mode & 0o777
  if (process.platform === 'win32') {
    check(fs.existsSync(vaultFile), 'vault file written (0600 is a no-op on Windows)')
  } else {
    check(vaultMode === 0o600, `vault file mode is 0600 (got ${vaultMode.toString(8)})`)
  }
  check((await handlers.get('ai:status')()).providers.openai === true, 'key status reflected')
  check((await handlers.get('ai:setKey')(null, 'nope', 'x')).ok === false, 'unknown provider rejected')
  check((await handlers.get('ai:setKey')(null, 'openai', 'x'.repeat(5000))).ok === false, 'oversized key rejected')

  const calls = []
  let next = { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'a caption' } }] }) }
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(next.body, { status: next.status })
  }

  const okRes = await handlers.get('ai:request')(null, {
    providerId: 'openai',
    modelId: 'gpt-4.1-mini',
    request: { kind: 'text', prompt: 'hi' },
  })
  check(okRes.ok && okRes.result?.text === 'a caption', 'proxy returns parsed text')
  check(calls[0].url === 'https://api.openai.com/v1/chat/completions', 'proxy hits the provider url')
  check(calls[0].init.headers.Authorization === 'Bearer sk-secret-123', 'proxy injects the vault key (trimmed)')

  next = { status: 200, body: JSON.stringify({ message: { content: 'local!' } }) }
  const localRes = await handlers.get('ai:request')(null, {
    providerId: 'ollama',
    modelId: 'qwen2.5vl:7b',
    request: { kind: 'text', prompt: 'hi' },
  })
  check(localRes.ok && calls[1].url === 'http://127.0.0.1:11434/api/chat', 'loopback http allowed for local models')

  const noKey = await handlers.get('ai:request')(null, {
    providerId: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    request: { kind: 'text', prompt: 'hi' },
  })
  check(noKey.ok === false && /No Groq key saved/.test(noKey.error.message), 'missing key is a friendly error')
  check(noKey.error.hint.includes('keychain'), 'missing-key hint points at the vault')

  const insecure = await handlers.get('ai:request')(null, {
    providerId: 'openai',
    modelId: 'gpt-4.1-mini',
    baseUrl: 'http://evil.example.com/v1',
    request: { kind: 'text', prompt: 'hi' },
  })
  check(insecure.ok === false && /https endpoints/.test(insecure.error.message), 'non-https base URL blocked')

  const badEdit = await handlers.get('ai:request')(null, {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    request: { kind: 'imageEdit', prompt: 'x', image: { dataUrl: 'data:image/jpeg;base64,AA', mime: 'image/jpeg' } },
  })
  check(badEdit.ok === false, 'image edit rejected for text-only providers')

  let attempts = 0
  global.fetch = async () => {
    attempts++
    if (attempts === 1) return new Response('{"error":{"message":"slow down"}}', { status: 429 })
    return new Response(JSON.stringify({ choices: [{ message: { content: 'second try' } }] }), { status: 200 })
  }
  const retried = await handlers.get('ai:request')(null, {
    providerId: 'openai',
    modelId: 'gpt-4.1-mini',
    request: { kind: 'text', prompt: 'hi' },
  })
  check(retried.ok && attempts === 2, '429 retried once')

  global.fetch = async () => new Response('{"error":{"message":"invalid api key"}}', { status: 401 })
  const unauth = await handlers.get('ai:request')(null, {
    providerId: 'openai',
    modelId: 'gpt-4.1-mini',
    request: { kind: 'text', prompt: 'hi' },
  })
  check(unauth.ok === false && unauth.httpStatus === 401, '401 mapped')

  global.fetch = async () => {
    throw new Error('fetch failed')
  }
  const offline = await handlers.get('ai:request')(null, {
    providerId: 'openai',
    modelId: 'gpt-4.1-mini',
    request: { kind: 'text', prompt: 'hi' },
  })
  check(offline.ok === false && offline.error.retryable === true, 'network failure is retryable')

  const files = await handlers.get('files:openImages')()
  check(files.length === 2 && files[1].type === 'image/png', 'native open returns typed files')
  check((await handlers.get('files:saveFile')(null, 'dump.zip', new Uint8Array([1, 2, 3]).buffer)).saved === true, 'native save writes the file')

  check((await handlers.get('shell:openExternal')(null, 'file:///etc/passwd')).ok === false, 'non-https external link refused')
  check((await handlers.get('shell:openExternal')(null, 'https://platform.openai.com/api-keys')).ok === true, 'https external link allowed')

  await handlers.get('ai:clearKey')(null, 'openai')
  check((await handlers.get('ai:status')()).providers.openai === false, 'clearKey removes the key')

  console.log(failures ? `\n${failures} FAILURES` : '\nall electron checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
