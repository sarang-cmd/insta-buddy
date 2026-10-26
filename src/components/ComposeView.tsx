import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
  Grid3X3,
  Image as ImageIcon,
  Sparkles,
  Square,
  Wand2,
} from 'lucide-react'
import { usePreview } from '../hooks'
import { getBridge } from '../lib/ai/bridge'
import { generateCaptionsWithAi } from '../lib/ai/tasks'
import { useAiStore } from '../lib/aiStore'
import { PhotoThumb } from './PhotoThumb'
import { useStore } from '../lib/store'
import { tripStats } from '../lib/grouping'
import { downloadBlob, exportDump } from '../lib/export'
import type { Photo } from '../lib/types'

const FORMATS: { id: '4:5' | '1:1' | '9:16'; label: string; ratio: number; w: number; h: number }[] = [
  { id: '4:5', label: '4:5', ratio: 4 / 5, w: 16, h: 20 },
  { id: '1:1', label: '1:1', ratio: 1, w: 20, h: 20 },
  { id: '9:16', label: '9:16', ratio: 9 / 16, w: 14, h: 24 },
]

function CaptionCard({
  title,
  value,
  onChange,
}: {
  title: string
  value: string
  onChange: (v: string) => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="caption-card">
      <div className="c-head">
        <strong>{title}</strong>
        <button
          className="btn small ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} spellCheck={false} />
    </div>
  )
}

export function ComposeView() {
  const photos = useStore((s) => s.photos)
  const sessions = useStore((s) => s.sessions)
  const clusters = useStore((s) => s.clusters)
  const format = useStore((s) => s.format)
  const ordering = useStore((s) => s.ordering)
  const setFormat = useStore((s) => s.setFormat)
  const setOrdering = useStore((s) => s.setOrdering)
  const toggleSelected = useStore((s) => s.toggleSelected)
  const selectAllHeroes = useStore((s) => s.selectAllHeroes)
  const clearSelection = useStore((s) => s.clearSelection)
  const captions = useStore((s) => s.captions)
  const overrides = useStore((s) => s.captionOverrides)
  const setCaptionOverride = useStore((s) => s.setCaptionOverride)
  const refreshCaptions = useStore((s) => s.refreshCaptions)
  const captionsSource = useStore((s) => s.captionsSource)
  const aiCaptionModel = useStore((s) => s.aiCaptionModel)
  const aiSettings = useAiStore((s) => s.settings)
  const aiProviderId = useAiStore((s) => s.settings.providerId)
  const aiCaptionBusy = useAiStore((s) => s.captionBusy)
  const aiSetBusy = useAiStore((s) => s.setCaptionBusy)
  const aiNotice = useAiStore((s) => s.setNotice)
  const aiSetOpen = useAiStore((s) => s.setOpen)
  const toast = useStore((s) => s.toast)
  const setView = useStore((s) => s.setView)

  const [mode, setMode] = useState<'grid' | 'frame'>('grid')
  const [cursor, setCursor] = useState(0)
  const [longEdge, setLongEdge] = useState(2048)
  const [includeOriginal, setIncludeOriginal] = useState(false)
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null)

  const stats = useMemo(() => tripStats(photos, sessions, clusters), [photos, sessions, clusters])

  const selected = useMemo(() => {
    const list = photos.filter((p) => p.selected && !p.hidden && p.status === 'ready')
    const sorted = [...list]
    if (ordering === 'chrono') sorted.sort((a, b) => a.meta.takenAt - b.meta.takenAt)
    if (ordering === 'best')
      sorted.sort((a, b) => (b.analysis?.scores.overall ?? 0) - (a.analysis?.scores.overall ?? 0))
    if (ordering === 'color')
      sorted.sort((a, b) => {
        const warm = (p: Photo) => {
          const h = p.analysis?.hist ?? []
          return (h[0] ?? 0) + (h[1] ?? 0) + (h[11] ?? 0)
        }
        return warm(b) - warm(a)
      })
    return sorted
  }, [photos, ordering])

  const activeFormat = FORMATS.find((f) => f.id === format) ?? FORMATS[0]
  const current = selected[Math.min(cursor, Math.max(0, selected.length - 1))]
  const preview = usePreview(current, 1200)

  const captionText = {
    short: overrides.short ?? captions?.short ?? '',
    playful: overrides.playful ?? captions?.playful ?? '',
    story: overrides.story ?? captions?.story ?? '',
  }

  const runAiCaptions = async () => {
    if (!aiProviderId) {
      aiNotice({
        tone: 'info',
        message: 'Pick an AI provider first.',
        hint: 'All 12 are optional — the local caption writer above never leaves the device.',
      })
      aiSetOpen(true)
      return
    }
    aiSetBusy(true)
    try {
      const result = await generateCaptionsWithAi(
        { photos: selected, sessions, stats: { total: stats.total, kept: selected.length, days: stats.days } },
        aiSettings,
      )
      const merged = {
        short: result.short || captionText.short,
        playful: result.playful || captionText.playful,
        story: result.story || captionText.story,
        hashtags: result.hashtags.length ? result.hashtags : (captions?.hashtags ?? []),
        altTexts: result.altTexts.length
          ? result.altTexts.map((text, i) => ({ photoId: selected[i]?.id ?? `ai-${i}`, text }))
          : (captions?.altTexts ?? []),
        vibe: result.vibe.name ? result.vibe : (captions?.vibe ?? { name: 'The trip', traits: [] }),
      }
      useStore.getState().applyAiCaptions(merged, { short: merged.short, playful: merged.playful, story: merged.story }, result.model)
      aiNotice({ tone: 'good', message: `Captions written by ${result.model}.` })
      toast('AI captions in — edit anything you like', 'good')
    } catch (err) {
      const e = err as { message?: string; hint?: string }
      aiNotice({ tone: 'warn', message: e.message ?? 'Caption generation failed.', hint: e.hint })
      toast(e.message ?? 'Caption generation failed.', 'warn')
    } finally {
      aiSetBusy(false)
    }
  }

  const runExport = async () => {
    if (!selected.length) {
      toast('Nothing selected to export.', 'warn')
      return
    }
    setExporting({ done: 0, total: selected.length + 2 })
    try {
      const blob = await exportDump(
        selected,
        { longEdge, includeOriginal, format, captions, captionText },
        (done, total) => setExporting({ done, total }),
      )
      const name = `insta-buddy-dump-${selected.length}-frames.zip`
      const bridge = getBridge()
      if (bridge) {
        const buffer = await blob.arrayBuffer()
        const res = await bridge.files.saveFile(name, buffer)
        if (res.saved) toast(`Saved to ${res.path ?? 'disk'}`, 'good')
        else toast('Export cancelled', 'info')
      } else {
        downloadBlob(blob, name)
        toast('Dump exported — photos, captions and a feed grid', 'good')
      }
    } catch (err) {
      console.error(err)
      toast('Export failed. Try a smaller long edge.', 'warn')
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="compose">
      <div className="compose-col left">
        <div className="rail-head">
          <h4>Format</h4>
        </div>
        <div className="format-toggle">
          {FORMATS.map((f) => (
            <button key={f.id} className={format === f.id ? 'active' : ''} onClick={() => setFormat(f.id)}>
              <span className="shape" style={{ width: f.w, height: f.h }} />
              {f.label}
            </button>
          ))}
        </div>

        <div className="rail-head">
          <h4>Order</h4>
        </div>
        <div className="chip-row">
          <button className={`chip ${ordering === 'chrono' ? 'active' : ''}`} onClick={() => setOrdering('chrono')}>
            Chronological
          </button>
          <button className={`chip ${ordering === 'best' ? 'active' : ''}`} onClick={() => setOrdering('best')}>
            Best first
          </button>
          <button className={`chip ${ordering === 'color' ? 'active' : ''}`} onClick={() => setOrdering('color')}>
            Colour flow
          </button>
        </div>

        <div className="rail-head">
          <h4>
            In the dump · {selected.length}
          </h4>
        </div>
        <div className="chip-row">
          <button className="chip" onClick={selectAllHeroes}>
            <Sparkles size={10} style={{ marginRight: 4 }} /> Keepers only
          </button>
          <button className="chip" onClick={clearSelection}>
            Clear
          </button>
        </div>
        <div className="selected-strip">
          {photos
            .filter((p) => p.status === 'ready' && !p.hidden)
            .sort((a, b) => a.meta.takenAt - b.meta.takenAt)
            .map((p) => {
              const idx = selected.findIndex((s) => s.id === p.id)
              return (
                <div
                  key={p.id}
                  className={`strip-item ${idx < 0 ? 'off' : ''}`}
                  onClick={() => toggleSelected(p.id)}
                  title={`${p.meta.fileName} · click to ${idx < 0 ? 'add' : 'remove'}`}
                >
                  <PhotoThumb photo={p} size={240} />
                  {idx >= 0 && <span className="n">{idx + 1}</span>}
                </div>
              )
            })}
        </div>

        <div className="export-card">
          <div className="row">
            <span>Long edge</span>
            <select
              className="mini-select"
              value={longEdge}
              onChange={(e) => setLongEdge(Number(e.target.value))}
            >
              <option value={1440}>1440 px</option>
              <option value={2048}>2048 px</option>
              <option value={3072}>3072 px</option>
            </select>
          </div>
          <div className="row">
            <span>Include originals</span>
            <input
              type="checkbox"
              checked={includeOriginal}
              onChange={(e) => setIncludeOriginal(e.target.checked)}
            />
          </div>
          <button className="btn primary" style={{ width: '100%' }} onClick={runExport} disabled={!!exporting}>
            {exporting ? (
              <>
                <span className="spinner" /> {exporting.done}/{exporting.total} rendering
              </>
            ) : (
              <>
                <Download size={14} /> Export dump ({selected.length})
              </>
            )}
          </button>
          <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
            ZIP of edited JPEGs, captions.txt + .json, and a 9-up feed grid. Rendering happens here, not on a server.
          </p>
        </div>
      </div>

      <div className="compose-col center">
        <div className="chip-row" style={{ marginBottom: 14 }}>
          <button className={`chip ${mode === 'grid' ? 'active' : ''}`} onClick={() => setMode('grid')}>
            <Grid3X3 size={11} style={{ marginRight: 4 }} /> Feed grid
          </button>
          <button className={`chip ${mode === 'frame' ? 'active' : ''}`} onClick={() => setMode('frame')}>
            <ImageIcon size={11} style={{ marginRight: 4 }} /> Single frame
          </button>
        </div>

        {mode === 'grid' ? (
          <div className="grid9">
            {Array.from({ length: 9 }).map((_, i) => {
              const p = selected[i]
              return (
                <div className="cell" key={i}>
                  {p ? <PhotoThumb photo={p} size={420} /> : <div style={{ width: '100%', height: '100%' }} />}
                  {p && <span className="num">{i + 1}</span>}
                </div>
              )
            })}
          </div>
        ) : current ? (
          <>
            <div className="preview-frame" style={{ aspectRatio: `${activeFormat.ratio}` }}>
              <img src={preview} alt={current.meta.fileName} />
            </div>
            <div className="preview-caption">
              {cursor + 1} / {selected.length} · {current.meta.fileName} · {format}
            </div>
            <div className="chip-row" style={{ marginTop: 10 }}>
              <button
                className="btn small"
                onClick={() => setCursor((c) => Math.max(0, c - 1))}
                disabled={cursor === 0}
              >
                <ArrowLeft size={12} />
              </button>
              <button
                className="btn small"
                onClick={() => setCursor((c) => Math.min(selected.length - 1, c + 1))}
                disabled={cursor >= selected.length - 1}
              >
                <ArrowRight size={12} />
              </button>
            </div>
          </>
        ) : (
          <div className="empty-note">Nothing selected yet. Pick a few frames on the left.</div>
        )}

        <p className="hint" style={{ marginTop: 16, textAlign: 'center', maxWidth: 420 }}>
          {mode === 'grid'
            ? 'Your feed as it will land. The first nine selected frames fill the grid.'
            : 'Exports match this frame — crop and extend are baked at full resolution.'}
        </p>
      </div>

      <div className="compose-col right">
        {captions && (
          <div className="vibe-card">
            <div className="v-name">{captions.vibe.name}</div>
            <small>{captions.vibe.traits.join(' · ')}</small>
          </div>
        )}

        <div className="rail-head" style={{ marginBottom: 8 }}>
          <h4>
            Captions{' '}
            <span className={`caption-source ${captionsSource === 'ai' ? 'ai' : ''}`}>
              {captionsSource === 'ai' ? aiCaptionModel ?? 'AI' : 'local'}
            </span>
          </h4>
          <button className="btn small ghost" onClick={refreshCaptions} title="Reroll the on-device captions">
            <Wand2 size={11} /> Reroll
          </button>
        </div>
        <button
          className={`btn small ${aiProviderId ? 'primary' : ''}`}
          style={{ width: '100%', marginBottom: 10 }}
          onClick={runAiCaptions}
          disabled={aiCaptionBusy}
          title={aiProviderId ? 'Write captions with your AI provider' : 'Configure an AI provider'}
        >
          <Sparkles size={12} />
          {aiCaptionBusy ? 'Writing…' : aiProviderId ? 'Write captions with AI' : 'Set up AI captions'}
        </button>
        <CaptionCard
          title="Short"
          value={captionText.short}
          onChange={(v) => setCaptionOverride('short', v)}
        />
        <CaptionCard
          title="Playful"
          value={captionText.playful}
          onChange={(v) => setCaptionOverride('playful', v)}
        />
        <CaptionCard title="Story" value={captionText.story} onChange={(v) => setCaptionOverride('story', v)} />

        {captions && (
          <>
            <div className="rail-head" style={{ marginBottom: 6 }}>
              <h4>Hashtags</h4>
              <button
                className="btn small ghost"
                onClick={() => navigator.clipboard.writeText(captions.hashtags.join(' '))}
              >
                <Copy size={11} /> Copy
              </button>
            </div>
            <div className="hashtags">
              {captions.hashtags.map((t) => (
                <button key={t} onClick={() => navigator.clipboard.writeText(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="rail-head" style={{ marginBottom: 6 }}>
              <h4>Dump summary</h4>
            </div>
            <div className="hint">
              {stats.total} shot · {stats.retakes} retakes cut · {stats.clusters} moments · {stats.days} day
              {stats.days > 1 ? 's' : ''} · {stats.kept} keepers. Captions and alt text are generated locally from
              capture time, scene scores and your selection — edit anything above.
            </div>
          </>
        )}

        <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
          <button className="btn" onClick={() => setView('review')}>
            <Square size={12} /> Back to review
          </button>
        </div>
      </div>
    </div>
  )
}
