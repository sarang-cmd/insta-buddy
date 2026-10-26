import { useState } from 'react'
import { Bot, Sparkles, Wand2, Pencil, Star } from 'lucide-react'
import type { Cluster, Photo } from '../lib/types'
import { PhotoThumb } from './PhotoThumb'
import { describeCluster } from '../lib/grouping'
import { suggestionsFor } from '../lib/suggestions'
import { useStore } from '../lib/store'
import { useAiStore } from '../lib/aiStore'
import { pickKeeperWithAi } from '../lib/ai/tasks'

interface Props {
  cluster: Cluster
  photos: Photo[]
  activeId: string | null
  showRetakes: boolean
}

export function ClusterCard({ cluster, photos, activeId, showRetakes }: Props) {
  const setActive = useStore((s) => s.setActive)
  const setEditorOpen = useStore((s) => s.setEditorOpen)
  const setHero = useStore((s) => s.setHero)
  const applySafeAll = useStore((s) => s.applySafeAll)

  const aiProviderId = useAiStore((s) => s.settings.providerId)
  const aiSettings = useAiStore((s) => s.settings)
  const aiNotice = useAiStore((s) => s.setNotice)
  const [picking, setPicking] = useState(false)
  const [pickNote, setPickNote] = useState<string | null>(null)

  const members = cluster.photoIds.map((id) => photos.find((p) => p.id === id)!).filter(Boolean)
  const hero = members.find((p) => p.id === cluster.heroId) ?? members[0]
  const visible = showRetakes ? members : members.filter((m) => m.role !== 'retake')
  const shown = activeId && members.some((m) => m.id === activeId) ? members.find((m) => m.id === activeId)! : hero
  const info = describeCluster(cluster, photos)
  const heroSuggestions = suggestionsFor(shown).length
  const heroEdited = shown.retouchCount > 0 || JSON.stringify(shown.recipe) !== JSON.stringify(shown.originalRecipe)

  const aiPick = async () => {
    if (!aiProviderId) {
      aiNotice({
        tone: 'info',
        message: 'No AI provider yet.',
        hint: 'Settings → AI, then the app can rank a burst for you. The local scores above need no setup.',
      })
      useAiStore.getState().setOpen(true)
      return
    }
    setPicking(true)
    setPickNote(null)
    try {
      const result = await pickKeeperWithAi(members, aiSettings)
      const winner = members[result.winner]
      if (winner) {
        setHero(winner.id)
        setPickNote(`${winner.meta.fileName}: ${result.why}`)
      }
    } catch (err) {
      const e = err as { message?: string; hint?: string }
      aiNotice({ tone: 'warn', message: e.message ?? 'AI pick failed.', hint: e.hint })
    } finally {
      setPicking(false)
    }
  }

  const openEditor = (photo: Photo) => {
    setActive(photo.id)
    setEditorOpen(true)
  }

  return (
    <article className="moment">
      <div className="moment-head">
        <span className="kicker">Moment</span>
        <span className="copy">{info.detail}</span>
        <span className={`tag ${cluster.kind}`}>{cluster.kind === 'burst' ? 'burst / retakes' : cluster.kind}</span>
        {heroEdited && <span className="tag good">edited</span>}
      </div>

      <div className="moment-body">
        <div
          className={`hero-shot ${activeId === shown.id ? 'active' : ''}`}
          onClick={() => setActive(shown.id)}
          onDoubleClick={() => openEditor(shown)}
          title="Click to inspect · double-click to edit"
        >
          <PhotoThumb photo={shown} size={900} />
          <div className="pill-badge hero">
            <Star size={10} fill="currentColor" /> keeper
          </div>
          {heroSuggestions > 0 && (
            <span className="sug-count">
              <Sparkles size={10} /> {heroSuggestions}
            </span>
          )}
          <div className="overlay">
            <span className="name">
              {shown.meta.fileName} · {Math.round(shown.analysis?.scores.overall ?? 0)}/100
            </span>
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation()
                openEditor(shown)
              }}
            >
              <Pencil size={11} /> Edit
            </button>
          </div>
        </div>

        <div className="filmstrip">
          {visible.map((photo) => {
            const load = suggestionsFor(photo).length
            const edited =
              photo.retouchCount > 0 || JSON.stringify(photo.recipe) !== JSON.stringify(photo.originalRecipe)
            return (
              <div
                key={photo.id}
                className={`mini ${activeId === photo.id ? 'active' : ''} ${photo.hidden ? 'hidden-photo' : ''}`}
                onClick={() => setActive(photo.id)}
                onDoubleClick={() => openEditor(photo)}
                title={`${photo.meta.fileName} · ${photo.role}${load ? ` · ${load} suggestions` : ''}`}
              >
                <PhotoThumb photo={photo} size={320} />
                <span className="role">{photo.role === 'hero' ? 'keeper' : photo.role}</span>
                {edited && <span className="dirty" />}
              </div>
            )
          })}
          {members.length > visible.length && (
            <div
              className="mini crowded"
              style={{ display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--text-faint)' }}
              title="Retakes hidden — toggle in the left rail"
            >
              +{members.length - visible.length}
            </div>
          )}
        </div>
      </div>

      <div className="moment-actions">
        <button className="btn small" onClick={() => applySafeAll(shown.id)}>
          <Wand2 size={11} /> Tidy this shot
        </button>
        {members.length > 1 && (
          <button className="btn small ghost" onClick={aiPick} disabled={picking} title="Ask your AI provider to rank this burst">
            <Bot size={11} /> {picking ? 'Comparing…' : 'Let AI pick'}
          </button>
        )}
        {members
          .filter((m) => m.id !== hero.id)
          .slice(0, 2)
          .map((m) => (
            <button key={m.id} className="btn small ghost" onClick={() => setHero(m.id)}>
              <Star size={11} /> Make #{members.indexOf(m) + 1} keeper
            </button>
          ))}
      </div>
      {pickNote && <p className="hint" style={{ marginTop: 8 }}>{pickNote}</p>}
    </article>
  )
}
