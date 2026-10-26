import { useEffect } from 'react'
import { CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import { useStore } from './lib/store'
import { useAiStore } from './lib/aiStore'
import { getBridge } from './lib/ai/bridge'
import { TopBar } from './components/TopBar'
import { DropView } from './components/DropView'
import { ReviewView } from './components/ReviewView'
import { ComposeView } from './components/ComposeView'
import { Editor } from './components/Editor'
import { AiSettings } from './components/AiSettings'

function ProcessingOverlay() {
  const processing = useStore((s) => s.processing)
  if (!processing) return null
  const pct = Math.round((processing.done / Math.max(1, processing.total)) * 100)
  const steps = ['read EXIF', 'decode', 'score', 'hash', 'group', 'suggest']
  return (
    <div className="processing">
      <div className="panel">
        <h3>Working through your dump</h3>
        <p>{processing.label} …</p>
        <div className="progress-track">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="pipeline">
          {steps.map((s, i) => (
            <span key={s} className={i <= Math.floor((pct / 100) * steps.length) ? 'on' : ''}>
              {s}
            </span>
          ))}
        </div>
        <p style={{ marginTop: 14, marginBottom: 0, fontFamily: 'var(--font-sans)', color: 'var(--text-faint)' }}>
          {processing.done} / {processing.total} · nothing is uploaded, this is all local CPU
        </p>
      </div>
    </div>
  )
}

function BusyOverlay() {
  const busy = useStore((s) => s.busy)
  const captionBusy = useAiStore((s) => s.captionBusy)
  const adviceBusy = useAiStore((s) => s.adviceBusy)
  const label = busy ?? (captionBusy ? 'Writing captions with your provider…' : adviceBusy ? 'Asking for a second opinion…' : null)
  if (!label) return null
  return (
    <div className="busy-overlay">
      <div className="box">
        <span className="spinner" /> {label}
      </div>
    </div>
  )
}

function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const clearToast = useStore((s) => s.clearToast)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => clearToast(t.id)}>
          {t.tone === 'good' ? (
            <CheckCircle2 size={14} />
          ) : t.tone === 'warn' ? (
            <TriangleAlert size={14} />
          ) : (
            <Info size={14} />
          )}
          {t.text}
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const view = useStore((s) => s.view)
  const photos = useStore((s) => s.photos)
  const addFiles = useStore((s) => s.addFiles)
  const processing = useStore((s) => s.processing)
  const hydrate = useAiStore((s) => s.hydrate)
  const setAiOpen = useAiStore((s) => s.setOpen)
  const setView = useStore((s) => s.setView)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // native menu → app actions (desktop build only)
  useEffect(() => {
    const bridge = getBridge()
    if (!bridge) return
    const events = (window as unknown as { buddyEvents?: { on: (c: string, fn: () => void) => () => void } }).buddyEvents
    if (!events) return
    const offs = [
      events.on('menu:settings', () => setAiOpen(true)),
      events.on('menu:review', () => setView('review')),
      events.on('menu:compose', () => setView('compose')),
      events.on('menu:open-photos', async () => {
        const files = await bridge.files.openImages()
        if (files.length) {
          await addFiles(
            files.map((f) => new File([f.data], f.name, { type: f.type, lastModified: f.lastModified })),
          )
        }
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [addFiles, setAiOpen, setView])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault()
        void addFiles(files)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === ',') {
        e.preventDefault()
        setAiOpen(true)
      }
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    }
  }, [addFiles, setAiOpen])

  const showDrop = view === 'drop' || photos.length === 0

  return (
    <div className="app">
      <TopBar />
      {showDrop ? <DropView /> : view === 'review' ? <ReviewView /> : <ComposeView />}
      <Editor />
      <AiSettings />
      {processing && <ProcessingOverlay />}
      <BusyOverlay />
      <Toasts />
    </div>
  )
}
