import { create } from 'zustand'
import { analyseBitmap } from './analysis'
import { generateCaptions, type CaptionSet } from './captions'
import { buildTrip, tripStats } from './grouping'
import { readExif } from './exif'
import { canvasToObjectUrl, decodeFile, drawToCanvas, renderPhoto, scaleToFit } from './image'
import { autoMask, inpaint } from './inpaint'
import { invalidatePhoto, primeImage } from './preview'
import { safeBulkPatch } from './suggestions'
import {
  EMPTY_RECIPE,
  type Adjust,
  type Photo,
  type Recipe,
  type Session,
  type Cluster,
  type Suggestion,
} from './types'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'good' | 'warn'
}

export type View = 'drop' | 'review' | 'compose'

interface AppState {
  photos: Photo[]
  sessions: Session[]
  clusters: Cluster[]
  view: View
  activeId: string | null
  processing: { total: number; done: number; label: string } | null
  format: '4:5' | '1:1' | '9:16'
  ordering: 'chrono' | 'best' | 'color'
  captions: CaptionSet | null
  captionsSource: 'local' | 'ai' | null
  aiCaptionModel: string | null
  captionOverrides: { short?: string; playful?: string; story?: string }
  toasts: Toast[]
  editorOpen: boolean
  busy: string | null
  showRetakes: boolean
  pendingRetouch: 'wires' | 'people' | 'object' | null
  heroOverrides: Record<string, string>

  addFiles: (files: File[]) => Promise<void>
  loadDemo: () => Promise<void>
  resetTrip: () => void
  setView: (v: View) => void
  setActive: (id: string | null) => void
  setEditorOpen: (open: boolean) => void
  toggleShowRetakes: () => void
  seedRetouch: (mode: 'wires' | 'people' | 'object' | null) => void

  updateRecipe: (id: string, patch: Partial<Recipe>) => void
  setRecipe: (id: string, recipe: Recipe) => void
  updateAdjust: (id: string, patch: Partial<Adjust>) => void
  applySuggestion: (id: string, suggestion: Suggestion) => Promise<void>
  applySafeAll: (id?: string) => Promise<void>
  applySafeToAll: () => void
  dismissSuggestion: (id: string, suggestionId: string) => void
  undoPhoto: (id: string) => void
  resetPhoto: (id: string) => void

  setHero: (photoId: string) => void
  toggleHidden: (id: string) => void
  toggleSelected: (id: string) => void
  selectAllHeroes: () => void
  clearSelection: () => void

  retouch: (id: string, mode: 'wires' | 'people' | 'object' | 'manual', mask?: HTMLCanvasElement) => Promise<void>

  setFormat: (f: AppState['format']) => void
  setOrdering: (o: AppState['ordering']) => void
  setCaptionOverride: (which: 'short' | 'playful' | 'story', text: string) => void
  refreshCaptions: () => void
  applyAiCaptions: (
    captions: CaptionSet,
    drafts: { short: string; playful: string; story: string },
    model: string,
  ) => void
  replaceBaseWithDataUrl: (id: string, dataUrl: string, label: string) => Promise<void>
  toast: (text: string, tone?: Toast['tone']) => void
  clearToast: (id: number) => void
}

let toastId = 1
let idCounter = 0
const nextId = () => `p${++idCounter}_${Math.random().toString(36).slice(2, 7)}`

function cloneRecipe(r: Recipe): Recipe {
  return { ...r, adjust: { ...r.adjust }, crop: r.crop ? { ...r.crop } : null }
}

function recompute(photos: Photo[], heroOverrides: Record<string, string> = {}) {
  const { sessions, clusters } = buildTrip(photos, heroOverrides)
  return { sessions, clusters }
}

async function buildPhoto(file: File): Promise<Photo> {
  const exif = await readExif(file)
  const bitmap = await decodeFile(file)
  const analysis = analyseBitmap(bitmap)
  const fit = scaleToFit(bitmap.width, bitmap.height, 640)
  const thumb = drawToCanvas(bitmap, fit.w, fit.h)
  const thumbUrl = await canvasToObjectUrl(thumb, 0.8)
  const originalUrl = URL.createObjectURL(file)
  const fullW = bitmap.width
  const fullH = bitmap.height
  bitmap.close?.()

  const takenAt = exif.takenAt ?? file.lastModified ?? Date.now()
  const recipe = EMPTY_RECIPE()
  return {
    id: nextId(),
    file,
    meta: {
      fileName: file.name,
      fileSize: file.size,
      ...exif,
      width: fullW,
      height: fullH,
      takenAt,
      takenAtSource: exif.takenAtSource ?? 'file',
    },
    status: 'ready',
    analysis: { ...analysis, aspect: analysis.aspect },
    thumbUrl,
    baseUrl: originalUrl,
    originalUrl,
    baseVersion: 0,
    retouchCount: 0,
    recipe,
    originalRecipe: cloneRecipe(recipe),
    role: 'single',
    hidden: false,
    selected: true,
    dismissed: [],
    undoStack: [],
  }
}

export const useStore = create<AppState>((set, get) => ({
  photos: [],
  sessions: [],
  clusters: [],
  view: 'drop',
  activeId: null,
  processing: null,
  format: '4:5',
  ordering: 'chrono',
  captions: null,
  captionsSource: null,
  aiCaptionModel: null,
  captionOverrides: {},
  toasts: [],
  editorOpen: false,
  busy: null,
  showRetakes: false,
  heroOverrides: {},
  pendingRetouch: null,

  toast: (text, tone = 'info') => {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
    setTimeout(() => get().clearToast(id), 4200)
  },
  clearToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  addFiles: async (files) => {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))
    if (!images.length) {
      get().toast('Those files were not images.', 'warn')
      return
    }
    const base = get().photos.length
    set({
      processing: { total: base + images.length, done: base, label: 'Reading files' },
      view: 'review',
    })
    for (let i = 0; i < images.length; i++) {
      const file = images[i]
      set({
        processing: {
          total: base + images.length,
          done: base + i,
          label: file.name.length > 26 ? `${file.name.slice(0, 24)}…` : file.name,
        },
      })
      try {
        const photo = await buildPhoto(file)
        set((s) => ({ photos: [...s.photos, photo] }))
      } catch (err) {
        get().toast(`Couldn't read ${file.name}`, 'warn')
        console.warn(err)
      }
      // let the browser paint progress
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0))
    }
    set((s) => {
      const trips = recompute(s.photos, s.heroOverrides)
      const activeId = s.activeId ?? trips.clusters[0]?.heroId ?? s.photos[0]?.id ?? null
      return { ...s, ...trips, processing: null, activeId }
    })
    const stats = tripStats(get().photos, get().sessions, get().clusters)
    get().toast(
      `${stats.total} photos in · ${stats.clusters} moments · ${stats.retakes} retakes flagged`,
      'good',
    )
    get().refreshCaptions()
    get().selectAllHeroes()
  },

  loadDemo: async () => {
    if (get().photos.length) {
      get().toast('Clear the current trip first.', 'warn')
      return
    }
    const { generateDemoFiles } = await import('./demo')
    const files = await generateDemoFiles((done, total, label) => {
      set({ processing: { total, done, label: `Painting demo shot · ${label}` } })
    })
    set({ processing: null })
    await get().addFiles(files)
  },

  resetTrip: () => {
    for (const p of get().photos) {
      if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl)
      if (p.originalUrl) URL.revokeObjectURL(p.originalUrl)
      if (p.baseUrl && p.baseUrl !== p.originalUrl) URL.revokeObjectURL(p.baseUrl)
      invalidatePhoto(p.id)
    }
    set({
      photos: [],
      sessions: [],
      clusters: [],
      view: 'drop',
      activeId: null,
      captions: null,
      heroOverrides: {},
      captionOverrides: {},
      processing: null,
      editorOpen: false,
    })
  },

  setView: (view) => {
    set({ view })
    if (view === 'compose' && !get().captions) get().refreshCaptions()
  },
  setActive: (activeId) => set({ activeId }),
  setEditorOpen: (editorOpen) => set({ editorOpen }),
  toggleShowRetakes: () => set((s) => ({ showRetakes: !s.showRetakes })),
  seedRetouch: (mode) => set({ pendingRetouch: mode }),

  updateRecipe: (id, patch) => {
    set((s) => ({
      photos: s.photos.map((p) => (p.id === id ? { ...p, recipe: { ...p.recipe, ...patch } } : p)),
    }))
    invalidatePhoto(id)
  },

  setRecipe: (id, recipe) => {
    set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, recipe } : p)) }))
    invalidatePhoto(id)
  },

  updateAdjust: (id, patch) => {
    set((s) => ({
      photos: s.photos.map((p) =>
        p.id === id ? { ...p, recipe: { ...p.recipe, adjust: { ...p.recipe.adjust, ...patch } } } : p,
      ),
    }))
    invalidatePhoto(id)
  },

  applySuggestion: async (id, suggestion) => {
    const photo = get().photos.find((p) => p.id === id)
    if (!photo || !suggestion.action) return
    if (suggestion.action.type === 'recipe') {
      const patch = suggestion.action.patch
      const next = {
        ...photo.recipe,
        ...patch,
        adjust: patch.adjust ? { ...patch.adjust } : photo.recipe.adjust,
        crop: patch.crop !== undefined ? patch.crop : photo.recipe.crop,
      }
      set((s) => ({
        photos: s.photos.map((p) => (p.id === id ? { ...p, recipe: next } : p)),
      }))
      invalidatePhoto(id)
      get().toast(`${suggestion.action.label} applied`, 'good')
    } else {
      // heuristic masks are never filled blind — open the editor with the mask pre-painted
      set({ activeId: id, pendingRetouch: suggestion.action.mode, editorOpen: true })
      get().toast('Mask pre-painted — check it, add to it, then fill.', 'info')
    }
  },

  applySafeAll: async (id) => {
    const photos = id ? get().photos.filter((p) => p.id === id) : get().photos
    let changed = 0
    for (const photo of photos) {
      if (!photo.analysis) continue
      const patch = safeBulkPatch(photo)
      if (!patch.adjust && patch.straighten === undefined) continue
      set((s) => ({
        photos: s.photos.map((p) =>
          p.id === photo.id
            ? {
                ...p,
                recipe: {
                  ...p.recipe,
                  straighten: patch.straighten ?? p.recipe.straighten,
                  adjust: patch.adjust ?? p.recipe.adjust,
                },
              }
            : p,
        ),
      }))
      invalidatePhoto(photo.id)
      changed++
    }
    get().toast(changed ? `Tidied up ${changed} photo${changed > 1 ? 's' : ''}` : 'Nothing safe to auto-fix', changed ? 'good' : 'info')
  },

  applySafeToAll: () => {
    get().applySafeAll()
  },

  dismissSuggestion: (id, suggestionId) => {
    set((s) => ({
      photos: s.photos.map((p) => (p.id === id ? { ...p, dismissed: [...p.dismissed, suggestionId] } : p)),
    }))
  },

  undoPhoto: (id) => {
    const photo = get().photos.find((p) => p.id === id)
    if (!photo || !photo.undoStack.length) return
    const stack = [...photo.undoStack]
    const last = stack.pop()!
    if (photo.baseUrl && photo.baseUrl !== photo.originalUrl) URL.revokeObjectURL(photo.baseUrl)
    invalidatePhoto(id)
    set((s) => ({
      photos: s.photos.map((p) =>
        p.id === id
          ? {
              ...p,
              baseUrl: last.baseUrl,
              recipe: last.recipe,
              undoStack: stack,
              baseVersion: p.baseVersion + 1,
              retouchCount: Math.max(0, p.retouchCount - 1),
            }
          : p,
      ),
    }))
    get().toast('Undone')
  },

  resetPhoto: (id) => {
    const photo = get().photos.find((p) => p.id === id)
    if (!photo) return
    if (photo.baseUrl && photo.baseUrl !== photo.originalUrl) URL.revokeObjectURL(photo.baseUrl)
    invalidatePhoto(id)
    set((s) => ({
      photos: s.photos.map((p) =>
        p.id === id
          ? {
              ...p,
              baseUrl: p.originalUrl,
              recipe: EMPTY_RECIPE(),
              undoStack: [],
              baseVersion: p.baseVersion + 1,
              retouchCount: 0,
              dismissed: [],
            }
          : p,
      ),
    }))
    get().toast('Photo reset to original')
  },

  setHero: (photoId) => {
    set((s) => {
      const photo = s.photos.find((p) => p.id === photoId)
      if (!photo || !photo.clusterId) return s
      const heroOverrides = { ...s.heroOverrides, [photo.clusterId]: photoId }
      const photos = s.photos.map((p) => (p.id === photoId ? { ...p, selected: true } : p))
      const { sessions, clusters } = recompute(photos, heroOverrides)
      return { photos, sessions, clusters, heroOverrides }
    })
    get().toast('Keeper updated')
  },

  toggleHidden: (id) => {
    set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, hidden: !p.hidden } : p)) }))
  },

  toggleSelected: (id) => {
    set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)) }))
  },

  selectAllHeroes: () => {
    set((s) => ({
      photos: s.photos.map((p) => ({
        ...p,
        selected: p.role === 'hero' || p.role === 'single',
      })),
    }))
  },

  clearSelection: () => set((s) => ({ photos: s.photos.map((p) => ({ ...p, selected: false })) })),

  retouch: async (id, mode, manualMask) => {
    const photo = get().photos.find((p) => p.id === id)
    if (!photo?.baseUrl) return
    set({ busy: 'Reading pixels…' })
    try {
      const img = await primeImage(photo.baseUrl)
      if (!img) throw new Error('image missing')
      // 1 — flatten current recipe so the mask maps 1:1 to what the user sees
      const working = renderPhoto(img, photo.recipe, { maxSize: 2000 })
      let mask = manualMask
      if (!mask) {
        const bitmap = await createImageBitmap(working)
        const analysis = analyseBitmap(bitmap)
        bitmap.close?.()
        const grow = 1.35
        const boxes =
          mode === 'people'
            ? analysis.people.map((b) => ({
                x: b.x - (b.w * (grow - 1)) / 2,
                y: b.y - (b.h * (grow - 1)) / 2,
                w: b.w * grow,
                h: b.h * grow,
              }))
            : mode === 'object'
              ? analysis.objects
              : []
        const lines = mode === 'wires' ? analysis.wires : []
        if (!boxes.length && !lines.length) {
          set({ busy: null })
          get().toast(
            mode === 'wires'
              ? 'No clear overhead lines left to remove.'
              : mode === 'people'
                ? 'No people-sized regions found in this frame.'
                : 'Nothing obvious to remove here — try the brush in the editor.',
            'warn',
          )
          return
        }
        mask = autoMask(working.width, working.height, boxes, lines, Math.max(6, working.width * 0.012))
      }
      set({ busy: 'Filling the gap…' })
      await new Promise((r) => setTimeout(r, 30))
      const { canvas } = inpaint(working, mask)
      const url = await canvasToObjectUrl(canvas, 0.93)
      const snapshot = { baseUrl: photo.baseUrl, recipe: cloneRecipe(photo.recipe) }
      invalidatePhoto(id)
      set((s) => ({
        photos: s.photos.map((p) =>
          p.id === id
            ? {
                ...p,
                baseUrl: url,
                recipe: EMPTY_RECIPE(),
                originalRecipe: p.originalRecipe,
                undoStack: [...p.undoStack, snapshot],
                baseVersion: p.baseVersion + 1,
                retouchCount: p.retouchCount + 1,
                meta: { ...p.meta, width: canvas.width, height: canvas.height },
              }
            : p,
        ),
        busy: null,
      }))
      get().toast('Object removed · mask filled from surrounding texture', 'good')
    } catch (err) {
      console.error(err)
      set({ busy: null })
      get().toast('Retouch failed on this image.', 'warn')
    }
  },

  setFormat: (format) => set({ format }),
  setOrdering: (ordering) => set({ ordering }),

  setCaptionOverride: (which, text) =>
    set((s) => ({ captionOverrides: { ...s.captionOverrides, [which]: text } })),

  refreshCaptions: () => {
    const { photos, sessions } = get()
    const stats = tripStats(photos, sessions, get().clusters)
    const selected = photos.filter((p) => p.selected && !p.hidden)
    const captions = generateCaptions(selected.length ? selected : photos, sessions, stats)
    set({ captions, captionOverrides: {}, captionsSource: 'local', aiCaptionModel: null })
  },

  applyAiCaptions: (captions, drafts, model) => {
    set({
      captions,
      captionsSource: 'ai',
      aiCaptionModel: model,
      captionOverrides: { short: drafts.short, playful: drafts.playful, story: drafts.story },
    })
  },

  replaceBaseWithDataUrl: async (id, dataUrl, label) => {
    const photo = get().photos.find((p) => p.id === id)
    if (!photo) return
    const blob = await (await fetch(dataUrl)).blob()
    const url = URL.createObjectURL(blob)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('bad image'))
      el.src = url
    })
    const snapshot = { baseUrl: photo.baseUrl!, recipe: cloneRecipe(photo.recipe) }
    if (photo.baseUrl && photo.baseUrl !== photo.originalUrl) URL.revokeObjectURL(photo.baseUrl)
    invalidatePhoto(id)
    set((s) => ({
      photos: s.photos.map((p) =>
        p.id === id
          ? {
              ...p,
              baseUrl: url,
              recipe: EMPTY_RECIPE(),
              baseVersion: p.baseVersion + 1,
              retouchCount: p.retouchCount + 1,
              undoStack: [...p.undoStack, snapshot],
              meta: { ...p.meta, width: img.naturalWidth, height: img.naturalHeight },
            }
          : p,
      ),
    }))
    get().toast(label, 'good')
  },
}))
