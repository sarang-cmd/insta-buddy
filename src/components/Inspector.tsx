import { Bot, Download, Eye, EyeOff, Pencil, RotateCcw, Sparkles, Star, Undo2, X } from 'lucide-react'
import { usePreview } from '../hooks'
import { downloadBlob, exportSingle } from '../lib/export'
import { formatTime, heroScore } from '../lib/grouping'
import { useStore } from '../lib/store'
import { useAiStore } from '../lib/aiStore'
import { cropForAspect } from '../lib/image'
import type { AiAdvice } from '../lib/ai/tasks'
import { suggestionTone, suggestionsFor } from '../lib/suggestions'
import type { Photo, Suggestion } from '../lib/types'

const KIND_COLORS: Record<Suggestion['kind'], string> = {
  geometry: '#ffb057',
  light: '#8ec5ff',
  color: '#c9a0ff',
  object: '#7ee0b8',
  quality: '#ff9aa2',
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const cls = value >= 66 ? '' : value >= 40 ? 'mid' : 'low'
  return (
    <div className="score-row">
      <span>{label}</span>
      <span className="bar">
        <i className={cls} style={{ width: `${Math.max(4, value)}%` }} />
      </span>
      <span>{value}</span>
    </div>
  )
}

export function Inspector({ photos }: { photos: Photo[] }) {
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const setEditorOpen = useStore((s) => s.setEditorOpen)
  const setHero = useStore((s) => s.setHero)
  const toggleHidden = useStore((s) => s.toggleHidden)
  const toggleSelected = useStore((s) => s.toggleSelected)
  const applySuggestion = useStore((s) => s.applySuggestion)
  const dismissSuggestion = useStore((s) => s.dismissSuggestion)
  const undoPhoto = useStore((s) => s.undoPhoto)
  const resetPhoto = useStore((s) => s.resetPhoto)
  const applySafeAll = useStore((s) => s.applySafeAll)
  const toast = useStore((s) => s.toast)

  const aiProviderId = useAiStore((s) => s.settings.providerId)
  const aiAdviceMap = useAiStore((s) => s.advice)
  const aiAdviceBusy = useAiStore((s) => s.adviceBusy)
  const requestAdvice = useAiStore((s) => s.requestAdvice)
  const clearAdvice = useAiStore((s) => s.clearAdvice)
  const updateRecipe = useStore((s) => s.updateRecipe)
  const updateAdjust = useStore((s) => s.updateAdjust)

  const photo = photos.find((p) => p.id === activeId)
  const preview = usePreview(photo, 900)

  if (!photo) {
    return (
      <aside className="panel">
        <div className="panel-empty">
          <Sparkles size={22} style={{ color: 'var(--accent-2)' }} />
          <h4>Pick a frame</h4>
          <p>Click any photo to see its scores, the keeper recommendation and the touch-ups we'd make.</p>
        </div>
      </aside>
    )
  }

  const a = photo.analysis
  const suggestions = suggestionsFor(photo)
  const cluster = useStore.getState().clusters.find((c) => c.id === photo.clusterId)
  const clusterMembers = cluster?.photoIds.map((id) => photos.find((p) => p.id === id)!).filter(Boolean) ?? []
  const bestInCluster = [...clusterMembers].sort((x, y) => heroScore(y) - heroScore(x))[0]
  const edited = photo.retouchCount > 0 || JSON.stringify(photo.recipe) !== JSON.stringify(photo.originalRecipe)
  const advice: AiAdvice | undefined = aiAdviceMap[photo.id]

  const applyAiEdit = (kind: string, amount?: number) => {
    const aspect = photo.analysis?.aspect ?? 1
    if (kind === 'straighten') {
      const deg = Math.max(-8, Math.min(8, amount ?? (photo.analysis?.tiltDeg ?? 0)))
      updateRecipe(photo.id, { straighten: deg })
    } else if (kind === 'crop') {
      const target = amount && amount > 0.4 && amount < 2 ? amount : 0.8
      const crop = cropForAspect(aspect, 1, target, photo.analysis?.subjectX ?? 0.5, photo.analysis?.subjectY ?? 0.5)
      updateRecipe(photo.id, { crop: { x: 0, y: crop.y, w: crop.w, h: crop.h } })
    } else if (kind === 'extend') {
      updateRecipe(photo.id, { extend: 0.8, crop: null })
    } else if (kind === 'sharpen') {
      updateAdjust(photo.id, { sharpen: Math.max(10, Math.min(60, amount ?? 25)) })
    } else if (kind === 'exposure') {
      const v = Math.max(-40, Math.min(40, amount ?? 10))
      updateAdjust(photo.id, v >= 0 ? { exposure: v, shadows: 18 } : { exposure: v, highlights: -20 })
    } else if (kind === 'color') {
      updateAdjust(photo.id, { vibrance: 18, temp: (photo.analysis?.wbCast ?? 0) > 0.08 ? -12 : 8 })
    } else if (kind === 'remove') {
      setEditorOpen(true)
    }
  }

  return (
    <aside className="panel">
      <div className="insp-preview">
        <img src={preview} alt={photo.meta.fileName} />
      </div>

      <div className="insp-title">
        <strong title={photo.meta.fileName}>{photo.meta.fileName}</strong>
        <button className="btn icon ghost" onClick={() => setActive(null)} title="Close">
          <X size={14} />
        </button>
      </div>

      <div className="insp-meta">
        <span>
          {photo.meta.width}×{photo.meta.height}
        </span>
        <span>{formatTime(photo.meta.takenAt)}</span>
        <span>{photo.meta.takenAtSource === 'exif' ? 'EXIF time' : 'file time'}</span>
        {photo.meta.camera && <span>{photo.meta.camera}</span>}
        {photo.meta.fNumber && <span>f/{photo.meta.fNumber}</span>}
        {photo.meta.iso && <span>ISO {photo.meta.iso}</span>}
      </div>

      {a && (
        <div className="scores">
          <ScoreBar label="Overall" value={a.scores.overall} />
          <ScoreBar label="Sharpness" value={a.scores.sharpness} />
          <ScoreBar label="Exposure" value={a.scores.exposure} />
          <ScoreBar label="Colour" value={a.scores.color} />
        </div>
      )}

      {photo.role !== 'hero' && bestInCluster && bestInCluster.id !== photo.id && (
        <div className="editor-note" style={{ borderColor: 'rgba(246,200,106,.28)' }}>
          <b style={{ color: 'var(--accent-2)' }}>Retake alert.</b> {bestInCluster.meta.fileName} scores higher in
          this moment ({Math.round(bestInCluster.analysis?.scores.overall ?? 0)} vs{' '}
          {Math.round(a?.scores.overall ?? 0)}).
        </div>
      )}

      <div className="section-label">
        <h4>AI second opinion</h4>
        <button
          className="btn small ghost"
          onClick={() => (advice ? clearAdvice(photo.id) : requestAdvice(photo))}
          disabled={aiAdviceBusy === photo.id}
          title={aiProviderId ? 'Ask your AI provider to review this frame' : 'Configure a provider in Settings → AI'}
        >
          <Bot size={11} /> {aiAdviceBusy === photo.id ? 'Reviewing…' : advice ? 'Clear' : aiProviderId ? 'Ask AI' : 'Set up AI'}
        </button>
      </div>

      {advice && (
        <div className="ai-advice">
          <h5>
            <Bot size={11} /> {advice.score}/10 · agent view
          </h5>
          <div className="verdict">{advice.verdict}</div>
          {advice.issues.length > 0 && (
            <ul>
              {advice.issues.map((issue, i) => (
                <li key={i} className={`sev-${issue.severity}`}>
                  <strong>{issue.type}</strong> — {issue.note}
                </li>
              ))}
            </ul>
          )}
          <div className="ai-edit-row">
            {advice.edits.map((edit, i) => (
              <button
                key={i}
                className="chip"
                title={edit.reason}
                onClick={() => applyAiEdit(edit.kind, edit.amount)}
              >
                {edit.kind === 'remove' ? 'Open eraser' : `Apply · ${edit.label}`}
              </button>
            ))}
          </div>
          <span className="model-tag">{advice.model}</span>
        </div>
      )}

      <div className="section-label">
        <h4>Suggested touch-ups</h4>
        <span className="conf">{suggestions.length}</span>
        {suggestions.some((s) => s.safe) && (
          <button className="btn small ghost" onClick={() => applySafeAll(photo.id)}>
            Apply safe
          </button>
        )}
      </div>

      <div className="suggestions">
        {suggestions.map((s) => (
          <div className="suggestion" key={s.id}>
            <div className="s-top">
              <span className="kind-dot" style={{ background: KIND_COLORS[s.kind] }} />
              <strong>{s.title}</strong>
              <span className="conf">{Math.round(s.confidence * 100)}%</span>
            </div>
            <p>{s.detail}</p>
            <div className="s-actions">
              {s.action && (
                <button className="apply" onClick={() => applySuggestion(photo.id, s)}>
                  {s.action.type === 'retouch' ? 'Open mask' : 'Apply'} · {suggestionTone(s.kind)}
                </button>
              )}
              <button className="dismiss" onClick={() => dismissSuggestion(photo.id, s.id)}>
                Not this one
              </button>
            </div>
          </div>
        ))}
        {!suggestions.length && (
          <div className="empty-note">
            Nothing worth touching. Straight, sharp and well exposed — leave it alone.
          </div>
        )}
      </div>

      <div className="insp-actions">
        <button className="btn span2 primary" onClick={() => setEditorOpen(true)}>
          <Pencil size={13} /> Open editor
        </button>
        <button className="btn" onClick={() => setHero(photo.id)} disabled={photo.role === 'hero'}>
          <Star size={13} /> Make keeper
        </button>
        <button className="btn" onClick={() => toggleSelected(photo.id)}>
          {photo.selected ? <Eye size={13} /> : <EyeOff size={13} />} {photo.selected ? 'In dump' : 'Add to dump'}
        </button>
        <button className="btn" onClick={() => toggleHidden(photo.id)}>
          <EyeOff size={13} /> {photo.hidden ? 'Unhide' : 'Hide'}
        </button>
        <button
          className="btn"
          disabled={!edited}
          onClick={() => {
            if (photo.undoStack.length) undoPhoto(photo.id)
            else resetPhoto(photo.id)
          }}
        >
          {photo.undoStack.length ? <Undo2 size={13} /> : <RotateCcw size={13} />}
          {photo.undoStack.length ? 'Undo edit' : 'Reset'}
        </button>
        <button
          className="btn span2 ghost"
          onClick={async () => {
            const blob = await exportSingle(photo, 2048)
            downloadBlob(blob, `insta-buddy-${photo.meta.fileName.replace(/\.[^.]+$/, '')}.jpg`)
            toast('Exported at 2048px', 'good')
          }}
        >
          <Download size={13} /> Export this frame
        </button>
      </div>
    </aside>
  )
}
