import { useMemo, useState } from 'react'
import { Clock, Eye, EyeOff, Sparkles, Wand2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { suggestionsFor } from '../lib/suggestions'
import { formatDay, formatTime, tripStats } from '../lib/grouping'
import { ClusterCard } from './ClusterCard'
import { Inspector } from './Inspector'

export function ReviewView() {
  const photos = useStore((s) => s.photos)
  const sessions = useStore((s) => s.sessions)
  const clusters = useStore((s) => s.clusters)
  const activeId = useStore((s) => s.activeId)
  const showRetakes = useStore((s) => s.showRetakes)
  const toggleShowRetakes = useStore((s) => s.toggleShowRetakes)
  const applySafeAll = useStore((s) => s.applySafeAll)
  const selectAllHeroes = useStore((s) => s.selectAllHeroes)
  const setView = useStore((s) => s.setView)
  const [sessionFilter, setSessionFilter] = useState<string | null>(null)

  const stats = useMemo(() => tripStats(photos, sessions, clusters), [photos, sessions, clusters])
  const shownSessions = sessionFilter ? sessions.filter((s) => s.id === sessionFilter) : sessions
  const visibleClusters = clusters.filter((c) => shownSessions.some((s) => s.id === c.sessionId))
  const pendingSuggestions = useMemo(() => {
    let count = 0
    for (const c of visibleClusters) {
      const hero = photos.find((p) => p.id === c.heroId)
      if (hero && suggestionsFor(hero).length) count++
    }
    return count
  }, [visibleClusters, photos])

  return (
    <div className="review">
      <aside className="rail">
        <div className="rail-head">
          <h4>Trip</h4>
          <span className="conf">{stats.days}d</span>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <b>{stats.total}</b>
            <small>photos</small>
          </div>
          <div className="stat">
            <b>{stats.clusters}</b>
            <small>moments</small>
          </div>
          <div className="stat">
            <b>{stats.retakes}</b>
            <small>retakes cut</small>
          </div>
          <div className="stat">
            <b>{stats.saving}%</b>
            <small>culled</small>
          </div>
        </div>

        <div className="rail-head">
          <h4>Sessions</h4>
        </div>
        <button
          className={`session-item ${sessionFilter === null ? 'active' : ''}`}
          onClick={() => setSessionFilter(null)}
        >
          <strong>Whole trip</strong>
          <small>
            {sessions.length} sessions · {formatDay(sessions[0]?.start ?? Date.now())}
          </small>
        </button>
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`session-item ${sessionFilter === s.id ? 'active' : ''}`}
            onClick={() => setSessionFilter(s.id)}
          >
            <strong>{s.title}</strong>
            <small>
              <Clock size={9} style={{ verticalAlign: -1 }} /> {formatTime(s.start)}–{formatTime(s.end)} · {s.subtitle.split(' · ')[0]}
            </small>
          </button>
        ))}

        <div className="rail-actions">
          <button className="btn small" onClick={toggleShowRetakes}>
            {showRetakes ? <EyeOff size={12} /> : <Eye size={12} />}
            {showRetakes ? 'Hide retakes' : 'Show retakes'}
          </button>
          <button className="btn small" onClick={() => applySafeAll()} title="Apply only the safe, reversible suggestions">
            <Wand2 size={12} /> Tidy all safe fixes
          </button>
          <button className="btn small ghost" onClick={selectAllHeroes}>
            <Sparkles size={12} /> Reselect keepers
          </button>
          <button className="btn small primary" onClick={() => setView('compose')}>
            Compose dump →
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-head">
          <div>
            <h2>{sessionFilter ? sessions.find((s) => s.id === sessionFilter)?.title : 'The whole trip, sorted'}</h2>
            <p>
              {visibleClusters.length} moments · {pendingSuggestions} keepers with touch-ups waiting ·{' '}
              {stats.kept} frames selected for the dump
            </p>
          </div>
          <div className="spacer" />
          <button className="btn small" onClick={() => applySafeAll()}>
            <Wand2 size={12} /> Tidy all safe
          </button>
        </div>

        <div className="moment-list">
          {visibleClusters.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              photos={photos}
              activeId={activeId}
              showRetakes={showRetakes}
            />
          ))}
          {!visibleClusters.length && (
            <div className="empty-note">No moments in this session yet — still analysing?</div>
          )}
        </div>
      </main>

      <Inspector photos={photos} />
    </div>
  )
}
