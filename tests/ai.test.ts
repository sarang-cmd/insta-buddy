/**
 * AI layer tests — no network, no Electron, no browser.
 * Bundled with esbuild and run in Node via `npm run test:ai`.
 */
const g = globalThis as unknown as Record<string, unknown>
let failures = 0
const check = (cond: unknown, label: string, extra?: unknown) => {
  if (!cond) {
    failures++
    console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra))
  } else console.log('ok  ', label)
}

g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }

/* ---------------------------------------------------------------- transport */
const { PROVIDERS, providerById, canDo, PROVIDER_COUNT } = await import('../src/lib/ai/providers')
const { buildRequest, extractJson, normaliseError, dataUrlToParts } = await import('../src/lib/ai/transport')

const IMG = 'data:image/jpeg;base64,AAAA'
check(PROVIDER_COUNT === 12, 'exactly 12 providers')

const bodies: Record<string, ReturnType<typeof buildRequest>> = {}
for (const p of PROVIDERS) {
  const model = p.models.find((m) => m.caps.includes('vision')) ?? p.models[0]
  const built = buildRequest(p, 'KEY123', model.id, {
    kind: 'vision',
    prompt: 'hi',
    images: [{ dataUrl: IMG, mime: 'image/jpeg' }],
    json: true,
  })
  bodies[p.id] = built
  const headers = (built.init.headers ?? {}) as Record<string, string>
  const body = typeof built.init.body === 'string' ? JSON.parse(built.init.body) : built.init.body
  const authOk = p.keyless
    ? !headers.Authorization
    : headers.Authorization === 'Bearer KEY123' ||
      headers['x-api-key'] === 'KEY123' ||
      headers['api-key'] === 'KEY123' ||
      headers['x-goog-api-key'] === 'KEY123'
  check(!!built.url && authOk && JSON.stringify(body).includes('AAAA'), `build ${p.id} (${p.transport})`)
}

const oa = JSON.parse(bodies['openai'].init.body as string)
check(oa.response_format?.type === 'json_object', 'openai json mode')
check(oa.messages[0].content[1].image_url.url === IMG, 'openai image_url shape')
const anth = JSON.parse(bodies['anthropic'].init.body as string)
check(anth.messages[0].content[1].source.type === 'base64', 'anthropic base64 source')
check((bodies['anthropic'].init.headers as Record<string, string>)['anthropic-version'] === '2023-06-01', 'anthropic version header')
const gem = JSON.parse(bodies['gemini'].init.body as string)
check(gem.contents[0].parts[1].inline_data.data === 'AAAA', 'gemini inline_data')
const oll = JSON.parse(bodies['ollama'].init.body as string)
check(Array.isArray(oll.messages[0].images) && oll.format === 'json', 'ollama native shape')
check(bodies['azure-openai'].url.includes('api-version=') && !!(bodies['azure-openai'].init.headers as Record<string, string>)['api-key'], 'azure api-version + api-key')
check((bodies['openrouter'].init.headers as Record<string, string>)['HTTP-Referer'] === 'https://insta-buddy.app', 'openrouter attribution')

for (const id of ['openai', 'azure-openai', 'together', 'gemini']) {
  const p = providerById(id)!
  const model = p.models.find((m) => m.caps.includes('imageEdit'))!.id
  const built = buildRequest(p, 'KEY', model, {
    kind: 'imageEdit',
    prompt: 'remove the wire',
    image: { dataUrl: IMG, mime: 'image/jpeg' },
    mask: { dataUrl: 'data:image/png;base64,BBBB', mime: 'image/png' },
  })
  const serialised = built.init.body instanceof FormData ? 'multipart' : String(built.init.body)
  check(serialised.includes('remove the wire') || serialised === 'multipart', `edit ${id} builds`, serialised.slice(0, 40))
  check(built.timeoutMs >= 240_000, `edit ${id} long timeout`)
}

let threw = false
try {
  buildRequest(providerById('anthropic')!, 'K', 'claude-sonnet-4-5', {
    kind: 'imageEdit',
    prompt: 'x',
    image: { dataUrl: IMG, mime: 'image/jpeg' },
  })
} catch {
  threw = true
}
check(threw, 'anthropic refuses imageEdit')
check(!canDo('openai', 'gpt-4.1-mini', 'imageEdit') && canDo('openai', 'gpt-image-1', 'imageEdit'), 'model-level capabilities')

check((extractJson('```json\n{"a":2}\n```') as { a: number })?.a === 2, 'extract fenced json')
check((extractJson('Sure: {"a":3} done') as { a: number })?.a === 3, 'extract embedded json')
check(extractJson('nothing here') === null, 'extract null on prose')
check(normaliseError(401, '{}', 'OpenAI').hint?.includes('Paste a fresh API key') === true, '401 hint')
check(normaliseError(429, '{}', 'Groq').retryable === true, '429 retryable')
check(normaliseError(404, '{}', 'Azure').hint?.includes('deployment') === true, '404 hint')
check(dataUrlToParts(IMG).base64 === 'AAAA', 'data url parse')

/* ------------------------------------------------------------------ runtime */
const { runAi, testProvider } = await import('../src/lib/ai/client')
const { setWebKey, DEFAULT_AI_SETTINGS } = await import('../src/lib/ai/settings')

g.window = {}
let lastCall: { url: string; init: RequestInit } | null = null
let next: { status: number; body: string } = { status: 200, body: '{}' }
g.fetch = async (url: string, init: RequestInit) => {
  lastCall = { url, init }
  return new Response(next.body, { status: next.status })
}

const settings = { ...DEFAULT_AI_SETTINGS, providerId: 'openai', modelId: 'gpt-4.1-mini', enabled: true }
setWebKey('openai', 'sk-test')

next = { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'hello there' } }], usage: { prompt_tokens: 12 } }) }
let res = await runAi({ kind: 'text', prompt: 'hi' }, { settings })
check(res.text === 'hello there' && res.usage?.input === 12, 'openai runtime text')

const anthSettings = { ...settings, providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }
setWebKey('anthropic', 'sk-ant')
next = { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: 'claude says hi' }] }) }
res = await runAi({ kind: 'text', prompt: 'hi' }, { settings: anthSettings })
check(res.text === 'claude says hi' && (lastCall?.init.headers as Record<string, string>)['x-api-key'] === 'sk-ant', 'anthropic runtime')

setWebKey('gemini', 'AIza')
next = { status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'a beach at sunset' }] } }] }) }
res = await runAi(
  { kind: 'vision', prompt: 'describe', images: [{ dataUrl: IMG, mime: 'image/jpeg' }] },
  { settings: { ...settings, providerId: 'gemini', modelId: 'gemini-2.5-flash' } },
)
check(res.text === 'a beach at sunset', 'gemini runtime vision')

next = { status: 200, body: JSON.stringify({ message: { content: 'local model here' } }) }
res = await runAi({ kind: 'text', prompt: 'hi' }, { settings: { ...settings, providerId: 'ollama', modelId: 'qwen2.5vl:7b' } })
check(res.text === 'local model here' && !(lastCall?.init.headers as Record<string, string>).Authorization, 'ollama keyless runtime')

next = { status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'QQQQ' } }] } }] }) }
const imgRes = await runAi(
  { kind: 'imageEdit', prompt: 'remove', image: { dataUrl: IMG, mime: 'image/jpeg' } },
  { settings: { ...settings, providerId: 'gemini', modelId: 'gemini-2.5-flash-image' } },
)
check(imgRes.images?.[0]?.dataUrl === 'data:image/png;base64,QQQQ', 'gemini image output parse')

next = { status: 401, body: '{"error":{"message":"invalid api key"}}' }
threw = false
try {
  await runAi({ kind: 'text', prompt: 'hi' }, { settings })
} catch (err) {
  threw = (err as Error).message.includes('rejected the key')
}
check(threw, '401 surfaces friendly error')

next = { status: 200, body: '{"choices":[{"message":{"content":"connected"}}]}' }
const tested = await testProvider(settings, 'openai')
check(tested.ok && tested.message.includes('answered in'), 'testProvider reports latency', tested.message)

// bridge path takes precedence over fetch
lastCall = null
g.window = { buddy: { desktop: true, ai: { request: async () => ({ ok: true, result: { text: 'bridged', model: 'm' } }) } } }
res = await runAi({ kind: 'text', prompt: 'hi' }, { settings })
check(res.text === 'bridged' && lastCall === null, 'electron bridge bypasses fetch')

/* -------------------------------------------------------------------- tasks */
class FakeCtx {
  createImageData(w: number, h: number) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < data.length; i += 4) {
      if ((i / 4) % 2 === 0) {
        data[i] = 255
        data[i + 1] = 255
        data[i + 2] = 255
        data[i + 3] = 255
      }
    }
    return { data, width: w, height: h }
  }
  putImageData() {}
  drawImage() {}
}
class FakeCanvas {
  width = 100
  height = 100
  getContext() {
    return new FakeCtx()
  }
  toDataURL(type = 'image/png') {
    return `data:${type};base64,CANVAS`
  }
  toBlob(cb: (b: Blob) => void) {
    cb(new Blob([new Uint8Array([1])]))
  }
}
g.document = { createElement: () => new FakeCanvas() }
g.Image = class {
  width = 1400
  height = 1000
  naturalWidth = 1400
  naturalHeight = 1000
  onload: (() => void) | null = null
  set src(_v: string) {
    setTimeout(() => this.onload?.(), 0)
  }
}

const sent: { providerId: string; modelId: string; request: { kind: string; prompt?: string; images?: unknown[]; mask?: { dataUrl: string } } }[] = []
let responder: (payload: unknown) => { ok: boolean; result?: unknown } = () => ({ ok: true, result: { text: '{}', model: 'mock' } })
g.window = {
  buddy: {
    desktop: true,
    ai: {
      request: async (payload: unknown) => {
        sent.push(payload as (typeof sent)[number])
        return responder(payload)
      },
    },
  },
}

const { generateCaptionsWithAi, reviewPhotoWithAi, pickKeeperWithAi, removeWithAi } = await import('../src/lib/ai/tasks')
const aiSettings = {
  ...DEFAULT_AI_SETTINGS,
  providerId: 'gemini',
  modelId: 'gemini-2.5-flash',
  enabled: true,
  allowImageUpload: true,
  imageEdge: 1024 as const,
}

const adjust = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, saturation: 0, vibrance: 0, sharpen: 0, vignette: 0 }
const mkPhoto = (id: string): Record<string, unknown> => ({
  id,
  file: {},
  status: 'ready',
  meta: { fileName: `${id}.JPG`, fileSize: 1, width: 1400, height: 1000, takenAt: Date.now(), takenAtSource: 'exif' },
  analysis: {
    scores: { sharpness: 55, exposure: 68, color: 40, overall: 55 },
    phash: 'ffff',
    hist: new Array(12).fill(0.1),
    coarse: new Array(24).fill(0.5),
    tiltDeg: 2,
    tiltConfidence: 0.8,
    horizonY: 0.4,
    skyFraction: 0.35,
    skyBand: { top: 0, bottom: 0.4 },
    wires: [],
    people: [],
    objects: [],
    subjectX: 0.5,
    subjectY: 0.5,
    aspect: 1.4,
    meanLuma: 0.45,
    clippedHighlights: 0.01,
    crushedShadows: 0.01,
    colorfulness: 30,
    saturation: 0.4,
    wbCast: 0.02,
  },
  thumbUrl: '',
  baseUrl: 'blob:photo',
  originalUrl: 'blob:photo',
  baseVersion: 0,
  retouchCount: 0,
  undoStack: [],
  recipe: { straighten: 0, crop: null, extend: null, adjust },
  originalRecipe: { straighten: 0, crop: null, extend: null, adjust: { ...adjust } },
  role: 'hero',
  hidden: false,
  selected: true,
  dismissed: [],
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photos = [mkPhoto('A'), mkPhoto('B')] as any

responder = () => ({
  ok: true,
  result: {
    text: '```json\n{"short":"3 days, 41 frames","playful":"p","story":"s","hashtags":["#photodump","travel diary","##goldenhour","x"],"vibe":{"name":"Coastal gold","traits":["low sun"]},"altTexts":["Sunset over the sea"]}\n```',
    model: 'm',
  },
})
const caps = await generateCaptionsWithAi(
  {
    photos,
    sessions: [
      {
        id: 's1',
        photoIds: ['A'],
        start: Date.now(),
        end: Date.now(),
        title: 'Golden hour · Sat 1 Jun',
        subtitle: '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
    stats: { total: 300, kept: 41, days: 3 },
  },
  aiSettings,
)
check(caps.short === '3 days, 41 frames', 'captions: short parsed')
check(caps.hashtags.includes('#traveldiary'), 'captions: hashtags normalised')
check(caps.vibe.name === 'Coastal gold' && caps.altTexts.length === 1, 'captions: vibe + alt text')
check(sent[0].request.kind === 'vision' && sent[0].request.images?.length === 2, 'captions: sends the frames')

sent.length = 0
responder = () => ({ ok: true, result: { text: '{"short":"a","playful":"b","story":"c","hashtags":[],"vibe":{"name":"n","traits":[]},"altTexts":[]}', model: 'm' } })
await generateCaptionsWithAi({ photos, sessions: [], stats: { total: 2, kept: 2, days: 1 } }, { ...aiSettings, allowImageUpload: false })
check(sent[0].request.kind === 'text', 'captions: text-only when uploads are off')

responder = () => ({ ok: true, result: { text: 'no json here', model: 'm' } })
threw = false
try {
  await generateCaptionsWithAi({ photos, sessions: [], stats: { total: 2, kept: 2, days: 1 } }, aiSettings)
} catch {
  threw = true
}
check(threw, 'captions: unparseable output throws')

responder = () => ({
  ok: true,
  result: {
    text: JSON.stringify({
      verdict: 'post it',
      score: 42,
      issues: [
        { type: 'horizon', severity: 'high', note: 'leaning' },
        { type: 'sharpness', severity: 'weird', note: 'soft' },
      ],
      edits: [
        { kind: 'straighten', amount: 2.1, reason: 'tilted', label: 'Level horizon' },
        { kind: 'banana', reason: 'nope', label: 'Nope' },
      ],
    }),
    model: 'm',
  },
})
const advice = await reviewPhotoWithAi(photos[0], aiSettings)
check(advice.score === 10 && advice.issues[1].severity === 'medium', 'review: clamps + normalises')
check(advice.edits.length === 1 && advice.edits[0].kind === 'straighten', 'review: drops unknown edit kinds')

threw = false
try {
  await reviewPhotoWithAi(photos[0], { ...aiSettings, allowImageUpload: false })
} catch (err) {
  threw = (err as Error).message.includes('Photo upload is off')
}
check(threw, 'review: privacy gate respected')

responder = () => ({ ok: true, result: { text: '{"winner": 99, "why": "sharpest"}', model: 'm' } })
const pick = await pickKeeperWithAi(photos, aiSettings)
check(pick.winner === 1, 'burst: winner index clamped')

responder = () => ({ ok: true, result: { images: [{ dataUrl: 'data:image/png;base64,RESULT', mime: 'image/png' }], model: 'm' } })
sent.length = 0
const erased = await removeWithAi(
  { image: new FakeCanvas() as unknown as HTMLCanvasElement, mask: new FakeCanvas() as unknown as HTMLCanvasElement, note: 'remove the wire' },
  aiSettings,
)
check(sent[0].modelId === 'gemini-2.5-flash-image', 'erase: auto-picks an image model')
check(sent[0].request.kind === 'imageEdit' && sent[0].request.mask?.dataUrl.startsWith('data:image/png'), 'erase: sends mask as png')
check(erased.dataUrl === 'data:image/png;base64,RESULT', 'erase: returns the new image')

console.log(failures ? `\n${failures} FAILURES` : '\nall AI checks passed')
process.exit(failures ? 1 : 0)
