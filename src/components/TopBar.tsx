import { Bot, Images, LayoutGrid, Lock, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { useAiStore } from '../lib/aiStore'

export function TopBar() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const photos = useStore((s) => s.photos)
  const selected = useStore((s) => s.photos.filter((p) => p.selected && !p.hidden).length)
  const reset = useStore((s) => s.resetTrip)
  const hasPhotos = photos.length > 0

  const aiOpen = useAiStore((s) => s.open)
  const setAiOpen = useAiStore((s) => s.setOpen)
  const providerId = useAiStore((s) => s.settings.providerId)
  const modelId = useAiStore((s) => s.settings.modelId)
  const desktop = useAiStore((s) => s.desktop)
  const providerName = useAiStore((s) => s.provider()?.name)
  const activeModel = useAiStore((s) => s.activeLabel())

  const back = () => {
    if (window.confirm('Clear this trip and start over? Edits are not saved anywhere.')) reset()
  }

  return (
    <header className="topbar">
      <div className="wordmark">
        <div className="mark">
          <Sparkles size={16} strokeWidth={2.4} />
        </div>
        <div>
          <h1>insta buddy</h1>
          <span>{desktop ? 'desktop · on-device' : 'dump, sorted'}</span>
        </div>
      </div>

      <div className="spacer" />

      <div className="ghost-chip privacy">
        <Lock size={12} /> on-device only
      </div>

      {hasPhotos && (
        <div className="ghost-chip">
          <Images size={12} /> {photos.length} photos · {selected} selected
        </div>
      )}

      <button
        className={`ai-chip ${providerId ? 'on' : ''}`}
        onClick={() => setAiOpen(!aiOpen)}
        title="AI providers (12 supported)"
      >
        <Bot size={13} />
        <span>{providerId ? `${providerName} · ${modelId || activeModel.split(' · ')[1] || ''}` : 'AI off · on-device'}</span>
        <Settings2 size={11} style={{ opacity: 0.6 }} />
      </button>

      <nav className="nav">
        <button className={view === 'review' ? 'active' : ''} disabled={!hasPhotos} onClick={() => setView('review')}>
          <Images size={13} /> Review
        </button>
        <button
          className={view === 'compose' ? 'active' : ''}
          disabled={!hasPhotos}
          onClick={() => setView('compose')}
        >
          <LayoutGrid size={13} /> Compose
        </button>
      </nav>

      {hasPhotos && (
        <button className="btn ghost small" onClick={back} title="Start a new trip">
          <Trash2 size={13} /> New trip
        </button>
      )}
    </header>
  )
}
