import { useEffect } from 'react'
import { CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import { useStore } from './lib/store'
import { TopBar } from './components/TopBar'
import { DropView } from './components/DropView'
import { ReviewView } from './components/ReviewView'
import { ComposeView } from './components/ComposeView'
import { Editor } from './components/Editor'

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
  if (!busy) return null
  return (
    <div className="busy-overlay">
      <div className="box">
        <span className="spinner" /> {busy}
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

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault()
        void addFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  const showDrop = view === 'drop' || photos.length === 0

  return (
    <div className="app">
      <TopBar />
      {showDrop ? <DropView /> : view === 'review' ? <ReviewView /> : <ComposeView />}
      <Editor />
      {processing && <ProcessingOverlay />}
      <BusyOverlay />
      <Toasts />
    </div>
  )
}
