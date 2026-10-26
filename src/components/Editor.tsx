import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Crop as CropIcon,
  Eraser,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Undo2,
  Users,
  Waves,
  X,
} from 'lucide-react'
import { ASPECTS, cropForAspect, ctx2d, makeCanvas, renderPhoto } from '../lib/image'
import { analyseBitmap } from '../lib/analysis'
import { autoMask } from '../lib/inpaint'
import { primeImage } from '../lib/preview'
import { useStore } from '../lib/store'
import { safeBulkPatch, suggestionsFor } from '../lib/suggestions'
import { EMPTY_RECIPE, type Adjust, type Recipe } from '../lib/types'

type Tab = 'light' | 'colour' | 'geometry' | 'retouch'

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  suffix = '',
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  suffix?: string
}) {
  return (
    <div className="slider">
      <div className="s-head">
        <span>{label}</span>
        <b>
          {value > 0 && min < 0 ? '+' : ''}
          {Math.round(value)}
          {suffix}
        </b>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function clone(r: Recipe): Recipe {
  return { ...r, adjust: { ...r.adjust }, crop: r.crop ? { ...r.crop } : null }
}

export function Editor() {
  const open = useStore((s) => s.editorOpen)
  const photo = useStore((s) => s.photos.find((p) => p.id === s.activeId))
  const setEditorOpen = useStore((s) => s.setEditorOpen)
  const setRecipe = useStore((s) => s.setRecipe)
  const undoPhoto = useStore((s) => s.undoPhoto)
  const resetPhoto = useStore((s) => s.resetPhoto)
  const retouch = useStore((s) => s.retouch)
  const pendingRetouch = useStore((s) => s.pendingRetouch)
  const seedRetouch = useStore((s) => s.seedRetouch)
  const toast = useStore((s) => s.toast)

  const [draft, setDraft] = useState<Recipe>(() => (photo ? clone(photo.recipe) : EMPTY_RECIPE()))
  const [tab, setTab] = useState<Tab>('light')
  const [brush, setBrush] = useState(false)
  const [brushSize, setBrushSize] = useState(46)
  const [comparing, setComparing] = useState(false)
  const [ready, setReady] = useState(false)
  const [dirty, setDirty] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const brushRef = useRef<HTMLCanvasElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const baseKeyRef = useRef<string>('')
  const paintingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [hasMask, setHasMask] = useState(false)

  const baseKey = photo ? `${photo.id}:${photo.baseVersion}` : ''
  const recipe = photo?.recipe

  // (re)load the base bitmap whenever the photo or its baked base changes
  useEffect(() => {
    if (!open || !photo?.baseUrl) return
    let cancelled = false
    setReady(false)
    primeImage(photo.baseUrl).then((img) => {
      if (cancelled) return
      imgRef.current = img
      setDraft(clone(recipe ?? EMPTY_RECIPE()))
      setReady(true)
      setDirty((d) => d + 1)
      baseKeyRef.current = baseKey
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, baseKey])

  // draw preview
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      const img = imgRef.current
      const canvas = canvasRef.current
      if (!img || !canvas) return
      const next = comparing ? EMPTY_RECIPE() : draft
      const rendered = renderPhoto(img, next, { maxSize: 1500 })
      canvas.width = rendered.width
      canvas.height = rendered.height
      ctx2d(canvas).drawImage(rendered, 0, 0)
      const b = brushRef.current
      if (b && !hasMask && (b.width !== rendered.width || b.height !== rendered.height)) {
        // keep the mask layer aligned with the preview so brush strokes land correctly
        b.width = rendered.width
        b.height = rendered.height
      }
    }, 40)
    return () => clearTimeout(timer)
  }, [draft, ready, comparing, dirty, hasMask])

  // seed the brush layer from detected wires / people when arriving from a suggestion
  useEffect(() => {
    if (!open || !ready || !pendingRetouch || !photo) return
    const brushLayer = brushRef.current
    if (!brushLayer || !imgRef.current) return
    const bitmap = renderPhoto(imgRef.current, draft, { maxSize: 1400 })
    brushLayer.width = bitmap.width
    brushLayer.height = bitmap.height
    const analysis = analyseBitmap(bitmap as unknown as ImageBitmap)
    const boxes = pendingRetouch === 'people' ? analysis.people : pendingRetouch === 'object' ? analysis.objects : []
    const lines = pendingRetouch === 'wires' ? analysis.wires : []
    const w = bitmap.width
    const h = bitmap.height
    if (boxes.length || lines.length) {
      const mask = autoMask(w, h, boxes, lines, Math.max(6, w * 0.012))
      const ctx = ctx2d(brushLayer)
      ctx.drawImage(mask, 0, 0)
      setHasMask(true)
    } else {
      toast('Nothing detected on this frame — paint it by hand instead.', 'warn')
    }
    setTab('retouch')
    setBrush(true)
    seedRetouch(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, pendingRetouch, photo?.id, draft])

  const close = useCallback(() => {
    setEditorOpen(false)
    setBrush(false)
    setHasMask(false)
  }, [setEditorOpen])

  const commit = useCallback(() => {
    if (!photo) return
    setRecipe(photo.id, clone(draft))
    close()
  }, [photo, draft, setRecipe, close])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        commit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, commit])

  const suggestions = useMemo(() => (photo ? suggestionsFor({ ...photo, recipe: draft }) : []), [photo, draft])

  const patchAdjust = (patch: Partial<Adjust>) =>
    setDraft((d) => ({ ...d, adjust: { ...d.adjust, ...patch } }))

  const stageAspect = photo?.analysis?.aspect ?? 1

  const applyCrop = (aspect: number | null) => {
    if (!aspect) {
      setDraft((d) => ({ ...d, crop: null }))
      return
    }
    const crop = cropForAspect(stageAspect, 1, aspect, photo?.analysis?.subjectX ?? 0.5, photo?.analysis?.subjectY ?? 0.5)
    setDraft((d) => ({ ...d, crop, extend: null }))
  }

  const applySafeHere = () => {
    if (!photo) return
    const patch = safeBulkPatch({ ...photo, recipe: draft })
    setDraft((d) => ({
      ...d,
      straighten: patch.straighten ?? d.straighten,
      adjust: patch.adjust ?? d.adjust,
    }))
  }

  // ---- brush ----
  const paintAt = (clientX: number, clientY: number) => {
    const b = brushRef.current
    if (!b) return
    const rect = b.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * b.width
    const y = ((clientY - rect.top) / rect.height) * b.height
    const ctx = ctx2d(b)
    const scale = b.width / rect.width
    const prev = lastPointRef.current
    ctx.strokeStyle = '#fff'
    ctx.fillStyle = '#fff'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = brushSize * scale
    if (prev) {
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(x, y)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(x, y, (brushSize * scale) / 2, 0, Math.PI * 2)
      ctx.fill()
    }
    lastPointRef.current = { x, y }
    setHasMask(true)
  }

  const clearMask = () => {
    const b = brushRef.current
    if (!b) return
    const ctx = ctx2d(b)
    ctx.clearRect(0, 0, b.width, b.height)
    setHasMask(false)
  }

  const runRetouch = async (mode: 'wires' | 'people' | 'object' | 'manual') => {
    if (!photo) return
    setRecipe(photo.id, clone(draft))
    await new Promise((r) => setTimeout(r, 30))
    let mask: HTMLCanvasElement | undefined
    if (mode === 'manual') {
      const b = brushRef.current
      if (!b || !hasMask) {
        toast('Paint over the thing you want gone first.', 'warn')
        return
      }
      mask = makeCanvas(b.width, b.height)
      const ctx = ctx2d(mask)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, mask.width, mask.height)
      ctx.drawImage(b, 0, 0)
    }
    setBrush(false)
    setHasMask(false)
    await retouch(photo.id, mode, mask)
  }

  if (!open || !photo) return null

  return (
    <div className="editor">
      <div className="editor-top">
        <button className="btn icon ghost" onClick={commit} title="Close (Esc)">
          <X size={16} />
        </button>
        <span className="title">
          {photo.meta.fileName} · {photo.meta.width}×{photo.meta.height}
          {photo.retouchCount > 0 ? ` · ${photo.retouchCount} retouch` : ''}
        </span>
        <div className="spacer" />
        <button
          className="btn small ghost"
          onPointerDown={() => setComparing(true)}
          onPointerUp={() => setComparing(false)}
          onPointerLeave={() => setComparing(false)}
          title="Hold to see the original"
        >
          Hold to compare
        </button>
        <button className="btn small ghost" onClick={applySafeHere} title="Apply the safe suggestions to this edit">
          <Sparkles size={12} /> Auto tidy
        </button>
        <button className="btn small primary" onClick={commit}>
          <Check size={13} /> Done
        </button>
      </div>

      <div className="editor-body">
        <div className="editor-stage">
          <div className="editor-canvas-wrap">
            <canvas ref={canvasRef} />
            {brush && (
              <canvas
                className="brush"
                ref={brushRef}
                style={{ mixBlendMode: 'screen', opacity: 0.85 }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  paintingRef.current = true
                  lastPointRef.current = null
                  paintAt(e.clientX, e.clientY)
                }}
                onPointerMove={(e) => {
                  if (!paintingRef.current) return
                  paintAt(e.clientX, e.clientY)
                }}
                onPointerUp={() => {
                  paintingRef.current = false
                  lastPointRef.current = null
                }}
                onPointerLeave={() => {
                  paintingRef.current = false
                  lastPointRef.current = null
                }}
              />
            )}
          </div>
          {brush && (
            <div className="stage-hint">
              Paint over wires, people or litter · brush {brushSize}px · the fill is synthesised from nearby texture
            </div>
          )}
          {comparing && <div className="stage-hint">Original · release to go back to your edit</div>}
        </div>

        <div className="editor-controls">
          <div className="tabs">
            <button className={tab === 'light' ? 'active' : ''} onClick={() => setTab('light')}>
              <Sun size={12} /> Light
            </button>
            <button className={tab === 'colour' ? 'active' : ''} onClick={() => setTab('colour')}>
              <SlidersHorizontal size={12} /> Colour
            </button>
            <button className={tab === 'geometry' ? 'active' : ''} onClick={() => setTab('geometry')}>
              <CropIcon size={12} /> Frame
            </button>
            <button
              className={tab === 'retouch' ? 'active' : ''}
              onClick={() => {
                setTab('retouch')
                setBrush(true)
              }}
            >
              <Eraser size={12} /> Retouch
            </button>
          </div>

          {suggestions.length > 0 && tab !== 'retouch' && (
            <>
              <div className="section-label">
                <h4>From your photo</h4>
              </div>
              <div className="chip-row">
                {suggestions.slice(0, 4).map((s) => (
                  <button
                    key={s.id}
                    className="chip"
                    title={s.detail}
                    onClick={() => {
                      if (!s.action) return
                      if (s.action.type === 'retouch') {
                        setTab('retouch')
                        void runRetouch(s.action.mode)
                      } else {
                        const patch = s.action.patch
                        setDraft((d) => ({
                          ...d,
                          ...patch,
                          adjust: patch.adjust ?? d.adjust,
                          crop: patch.crop !== undefined ? patch.crop : d.crop,
                        }))
                      }
                    }}
                  >
                    <Sparkles size={9} style={{ marginRight: 4 }} />
                    {s.title}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'light' && (
            <>
              <Slider label="Exposure" value={draft.adjust.exposure} min={-100} max={100} onChange={(v) => patchAdjust({ exposure: v })} />
              <Slider label="Contrast" value={draft.adjust.contrast} min={-100} max={100} onChange={(v) => patchAdjust({ contrast: v })} />
              <Slider label="Highlights" value={draft.adjust.highlights} min={-100} max={100} onChange={(v) => patchAdjust({ highlights: v })} />
              <Slider label="Shadows" value={draft.adjust.shadows} min={-100} max={100} onChange={(v) => patchAdjust({ shadows: v })} />
              <div className="editor-foot">
                <button className="btn small ghost" onClick={() => patchAdjust({ exposure: 0, contrast: 0, highlights: 0, shadows: 0 })}>
                  <RotateCcw size={11} /> Reset light
                </button>
              </div>
            </>
          )}

          {tab === 'colour' && (
            <>
              <Slider label="Temperature" value={draft.adjust.temp} min={-100} max={100} onChange={(v) => patchAdjust({ temp: v })} />
              <Slider label="Saturation" value={draft.adjust.saturation} min={-100} max={100} onChange={(v) => patchAdjust({ saturation: v })} />
              <Slider label="Vibrance" value={draft.adjust.vibrance} min={-100} max={100} onChange={(v) => patchAdjust({ vibrance: v })} />
              <Slider label="Sharpen" value={draft.adjust.sharpen} min={0} max={100} onChange={(v) => patchAdjust({ sharpen: v })} />
              <Slider label="Vignette" value={draft.adjust.vignette} min={0} max={100} onChange={(v) => patchAdjust({ vignette: v })} />
              <div className="editor-foot">
                <button
                  className="btn small ghost"
                  onClick={() => patchAdjust({ temp: 0, saturation: 0, vibrance: 0, sharpen: 0, vignette: 0 })}
                >
                  <RotateCcw size={11} /> Reset colour
                </button>
              </div>
            </>
          )}

          {tab === 'geometry' && (
            <>
              <Slider
                label="Straighten"
                value={draft.straighten}
                min={-15}
                max={15}
                suffix="°"
                onChange={(v) => setDraft((d) => ({ ...d, straighten: v }))}
              />
              {photo.analysis && Math.abs(photo.analysis.tiltDeg) >= 0.5 && (
                <div className="chip-row">
                  <button
                    className="chip active"
                    onClick={() => setDraft((d) => ({ ...d, straighten: photo.analysis!.tiltDeg }))}
                  >
                    Auto-level horizon ({photo.analysis.tiltDeg > 0 ? '+' : ''}
                    {photo.analysis.tiltDeg.toFixed(1)}°)
                  </button>
                </div>
              )}
              <div className="section-label">
                <h4>Crop</h4>
              </div>
              <div className="chip-row">
                <button className={`chip ${!draft.crop ? 'active' : ''}`} onClick={() => applyCrop(null)}>
                  Original
                </button>
                {ASPECTS.slice(0, 4).map((a) => (
                  <button
                    key={a.id}
                    className={`chip ${
                      draft.crop && Math.abs(draft.crop.w * stageAspect - (a.value * draft.crop.h)) < 0.04 ? 'active' : ''
                    }`}
                    onClick={() => applyCrop(a.value)}
                  >
                    {a.id}
                  </button>
                ))}
              </div>
              <div className="section-label">
                <h4>Extend (outpaint)</h4>
              </div>
              <div className="chip-row">
                <button className={`chip ${!draft.extend ? 'active' : ''}`} onClick={() => setDraft((d) => ({ ...d, extend: null }))}>
                  Off
                </button>
                <button
                  className={`chip ${draft.extend === 0.8 ? 'active' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, extend: 0.8, crop: null }))}
                >
                  4:5
                </button>
                <button
                  className={`chip ${draft.extend === 1 ? 'active' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, extend: 1, crop: null }))}
                >
                  1:1
                </button>
                <button
                  className={`chip ${draft.extend === 9 / 16 ? 'active' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, extend: 9 / 16, crop: null }))}
                >
                  Story
                </button>
              </div>
              <div className="editor-note">
                Extend mirrors and softens the edge pixels into the new space. Great for sky, sea and plain walls — it
                will not invent signage or faces.
              </div>
              <div className="editor-foot">
                <button
                  className="btn small ghost"
                  onClick={() => setDraft((d) => ({ ...d, straighten: 0, crop: null, extend: null }))}
                >
                  <RotateCcw size={11} /> Reset frame
                </button>
              </div>
            </>
          )}

          {tab === 'retouch' && (
            <>
              <div className="editor-note">
                Paint over what you want gone, then fill. The mask is resolved with patch synthesis from the surrounding
                texture — best on wires, poles, signs, bins, stray people. Straight edges and repeating patterns work
                best.
              </div>
              <div className="section-label">
                <h4>Auto masks</h4>
              </div>
              <div className="chip-row">
                <button className="chip" onClick={() => runRetouch('wires')} disabled={!photo.analysis?.wires.length}>
                  <Waves size={10} style={{ marginRight: 4 }} /> Wires / poles
                </button>
                <button className="chip" onClick={() => runRetouch('people')} disabled={!photo.analysis?.people.length}>
                  <Users size={10} style={{ marginRight: 4 }} /> People
                </button>
                <button className="chip" onClick={() => runRetouch('object')} disabled={!photo.analysis?.objects.length}>
                  <Eraser size={10} style={{ marginRight: 4 }} /> Distraction
                </button>
              </div>
              <div className="section-label">
                <h4>Brush</h4>
                <button className="btn small ghost" onClick={clearMask} disabled={!hasMask}>
                  Clear
                </button>
              </div>
              <Slider label="Brush size" value={brushSize} min={10} max={160} onChange={setBrushSize} />
              <div className="chip-row">
                <button className={`chip ${brush ? 'active' : ''}`} onClick={() => setBrush(true)}>
                  Paint mask
                </button>
                <button className="chip" onClick={() => setBrush(false)}>
                  Hide overlay
                </button>
              </div>
              <button className="btn primary" style={{ width: '100%' }} onClick={() => runRetouch('manual')} disabled={!hasMask}>
                <Eraser size={13} /> Fill painted area
              </button>
            </>
          )}

          <div className="editor-foot">
            <button
              className="btn small ghost"
              onClick={() => {
                if (!photo) return
                if (photo.undoStack.length) undoPhoto(photo.id)
                else toast('Nothing to undo yet', 'info')
              }}
              disabled={!photo.undoStack.length}
            >
              <Undo2 size={11} /> Undo retouch
            </button>
            <button
              className="btn small ghost"
              onClick={() => {
                setDraft(EMPTY_RECIPE())
                resetPhoto(photo.id)
              }}
            >
              <RotateCcw size={11} /> Reset everything
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
