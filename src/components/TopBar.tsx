import { Images, LayoutGrid, Lock, Sparkles, Trash2 } from 'lucide-react'
import { useStore } from '../lib/store'

export function TopBar() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const photos = useStore((s) => s.photos)
  const selected = useStore((s) => s.photos.filter((p) => p.selected && !p.hidden).length)
  const reset = useStore((s) => s.resetTrip)
  const hasPhotos = photos.length > 0

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
          <span>dump, sorted</span>
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
