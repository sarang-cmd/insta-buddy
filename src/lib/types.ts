export interface Gps {
  lat: number
  lon: number
}

export interface PhotoMeta {
  fileName: string
  fileSize: number
  width: number
  height: number
  /** ms epoch used for ordering */
  takenAt: number
  takenAtSource: 'exif' | 'file'
  gps?: Gps
  camera?: string
  lens?: string
  iso?: number
  fNumber?: number
  exposureTime?: number
  focalLength?: number
}

export interface Scores {
  sharpness: number // 0-100
  exposure: number // 0-100
  color: number // 0-100
  overall: number // 0-100
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
  confidence: number
}

export interface LineCandidate {
  x1: number
  y1: number
  x2: number
  y2: number
  /** wire = long, thin, near-horizontal; pole = long near-vertical */
  kind: 'wire' | 'pole'
  strength: number
}

export interface PhotoAnalysis {
  scores: Scores
  /** 64-bit difference hash, hex */
  phash: string
  /** 12-bin hue histogram, normalised */
  hist: number[]
  /** 6x4 coarse luma signature (0..1) — blur and exposure tolerant */
  coarse: number[]
  /** signed degrees the frame must rotate to level the horizon */
  tiltDeg: number
  tiltConfidence: number
  /** normalised y of the strongest horizon line */
  horizonY: number
  skyFraction: number
  skyBand: { top: number; bottom: number } | null
  wires: LineCandidate[]
  people: Box[]
  objects: Box[]
  subjectX: number
  subjectY: number
  aspect: number
  meanLuma: number
  clippedHighlights: number
  crushedShadows: number
  colorfulness: number
  saturation: number
  wbCast: number // >0 warm, <0 cool
}

export interface Adjust {
  exposure: number // -100..100
  contrast: number
  highlights: number
  shadows: number
  temp: number
  saturation: number
  vibrance: number
  sharpen: number // 0..100
  vignette: number // 0..100
}

export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

export interface Recipe {
  straighten: number
  crop: Crop | null
  /** target aspect (w/h) for generative expand, null = off */
  extend: number | null
  adjust: Adjust
}

export const DEFAULT_ADJUST: Adjust = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temp: 0,
  saturation: 0,
  vibrance: 0,
  sharpen: 0,
  vignette: 0,
}

export const DEFAULT_RECIPE: Recipe = {
  straighten: 0,
  crop: null,
  extend: null,
  adjust: { ...DEFAULT_ADJUST },
}

export type PhotoStatus = 'queued' | 'decoding' | 'analysing' | 'ready' | 'error'
export type PhotoRole = 'hero' | 'retake' | 'alt' | 'single'

export interface Photo {
  id: string
  file: File
  meta: PhotoMeta
  status: PhotoStatus
  error?: string
  analysis?: PhotoAnalysis
  thumbUrl?: string
  /** current source bitmap for rendering: original blob URL, or retouched result */
  baseUrl?: string
  originalUrl?: string
  baseVersion: number
  retouchCount: number
  undoStack: { baseUrl: string; recipe: Recipe }[]
  recipe: Recipe
  originalRecipe: Recipe
  clusterId?: string
  sessionId?: string
  role: PhotoRole
  hidden: boolean
  selected: boolean
  dismissed: string[]
}

export type SuggestionKind = 'geometry' | 'light' | 'color' | 'object' | 'quality'
export type SuggestionAction =
  | { type: 'recipe'; patch: Partial<Recipe>; label: string }
  | { type: 'retouch'; mode: 'wires' | 'people' | 'object' }

export interface Suggestion {
  id: string
  kind: SuggestionKind
  title: string
  detail: string
  confidence: number
  /** auto-safe suggestions can be applied in one "tidy up" pass */
  safe: boolean
  action?: SuggestionAction
}

export interface Session {
  id: string
  photoIds: string[]
  start: number
  end: number
  gps?: Gps
  title: string
  subtitle: string
}

export interface Cluster {
  id: string
  sessionId: string
  photoIds: string[]
  heroId: string
  kind: 'burst' | 'similar' | 'single'
  label: string
  detail: string
}

export const EMPTY_RECIPE = (): Recipe => ({
  straighten: 0,
  crop: null,
  extend: null,
  adjust: { ...DEFAULT_ADJUST },
})
