import { coarseDistance, hamming, histogramDistance } from './analysis'
import type { Cluster, Photo, Session } from './types'

const SESSION_GAP_MS = 45 * 60 * 1000
const BURST_GAP_MS = 12 * 60 * 1000

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function timeOfDay(ts: number) {
  const h = new Date(ts).getHours()
  if (h < 6) return 'night'
  if (h < 9) return 'early morning'
  if (h < 12) return 'morning'
  if (h < 16) return 'afternoon'
  if (h < 19) return 'golden hour'
  if (h < 21) return 'sunset'
  return 'night'
}

export function formatDay(ts: number) {
  const d = new Date(ts)
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function sortByTime(a: Photo, b: Photo) {
  return a.meta.takenAt - b.meta.takenAt
}

function distance(a: Photo, b: Photo) {
  if (!a.analysis || !b.analysis) return 64
  return hamming(a.analysis.phash, b.analysis.phash)
}

function similar(a: Photo, b: Photo) {
  if (!a.analysis || !b.analysis) return false
  const h = hamming(a.analysis.phash, b.analysis.phash)
  if (h <= 12) return true
  if (h <= 20) return histogramDistance(a.analysis.hist, b.analysis.hist) < 0.1
  // soft frames in a burst drift on the hash but keep the same layout
  const coarse = coarseDistance(a.analysis.coarse, b.analysis.coarse)
  const gap = Math.abs(a.meta.takenAt - b.meta.takenAt)
  if (h <= 26 && coarse < 0.08) return true
  if (gap <= 120_000 && coarse < 0.13) return true
  return false
}

function sessionTitle(photos: Photo[]) {
  const first = photos[0]
  const day = formatDay(first.meta.takenAt)
  const tod = timeOfDay(first.meta.takenAt)
  const city = tod === 'golden hour' || tod === 'sunset' ? 'Golden hour' : capitalize(tod)
  const gps = first.meta.gps
  const place = gps ? `${Math.abs(gps.lat).toFixed(2)}°${gps.lat >= 0 ? 'N' : 'S'}, ${Math.abs(gps.lon).toFixed(2)}°${gps.lon >= 0 ? 'E' : 'W'}` : null
  return {
    title: `${city} · ${day}`,
    subtitle: place ? `${place} · ${photos.length} photos` : `${photos.length} photos · no GPS in EXIF`,
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function samePlace(a?: Photo, b?: Photo) {
  if (!a?.meta.gps || !b?.meta.gps) return true
  return Math.abs(a.meta.gps.lat - b.meta.gps.lat) < 0.02 && Math.abs(a.meta.gps.lon - b.meta.gps.lon) < 0.02
}

export function heroScore(p: Photo) {
  const a = p.analysis
  if (!a) return 0
  let score = a.scores.overall
  // prefer frames that need less repair
  score -= Math.abs(a.tiltDeg) * 0.8
  score -= a.people.length * 0.4
  return score
}

export function describeCluster(cluster: Cluster, photos: Photo[]) {
  const members = cluster.photoIds.map((id) => photos.find((p) => p.id === id)!).filter(Boolean)
  const hero = members.find((p) => p.id === cluster.heroId) ?? members[0]
  const heroIndex = members.indexOf(hero) + 1
  const reasons: string[] = []
  if (hero.analysis) {
    const best = members.filter((p) => p.analysis)
    const sharpest = best.reduce((a, b) => (heroScore(b) > heroScore(a) ? b : a), hero)
    if (sharpest.id === hero.id && best.length > 1) reasons.push('sharpest')
    const bestExposed = [...best].sort(
      (x, y) => (y.analysis!.scores.exposure ?? 0) - (x.analysis!.scores.exposure ?? 0),
    )[0]
    if (bestExposed && bestExposed.id === hero.id && best.length > 1) reasons.push('best exposed')
    if (!reasons.length) reasons.push('highest overall score')
  }
  const retakes = members.filter((m) => m.role === 'retake').length
  const label = cluster.kind === 'single' ? 'Single shot' : `${members.length} shots`
  const detail =
    members.length > 1
      ? `${label} · keeper #${heroIndex} (${reasons.join(', ')})${retakes ? ` · ${retakes} retake${retakes > 1 ? 's' : ''}` : ''}`
      : `${label} · ${hero.analysis ? `${hero.analysis.scores.overall}/100 overall` : 'analysing'}`
  return { detail, heroIndex, reasons }
}

export function buildTrip(
  photos: Photo[],
  heroOverrides: Record<string, string> = {},
): { sessions: Session[]; clusters: Cluster[] } {
  const usable = photos.filter((p) => p.status === 'ready' && p.analysis).sort(sortByTime)
  if (!usable.length) return { sessions: [], clusters: [] }

  // 1 — sessions split on long gaps
  const sessionGroups: Photo[][] = []
  let current: Photo[] = []
  for (const photo of usable) {
    const prev = current[current.length - 1]
    if (prev && (photo.meta.takenAt - prev.meta.takenAt > SESSION_GAP_MS || !samePlace(prev, photo))) {
      sessionGroups.push(current)
      current = []
    }
    current.push(photo)
  }
  if (current.length) sessionGroups.push(current)

  const sessions: Session[] = []
  const clusters: Cluster[] = []

  sessionGroups.forEach((group, sIndex) => {
    const sessionId = `s${sIndex}`
    const { title, subtitle } = sessionTitle(group)
    const session: Session = {
      id: sessionId,
      photoIds: group.map((p) => p.id),
      start: group[0].meta.takenAt,
      end: group[group.length - 1].meta.takenAt,
      gps: group.find((p) => p.meta.gps)?.meta.gps,
      title,
      subtitle,
    }
    sessions.push(session)

    // 2 — moments inside the session (single-link on visual similarity + time)
    const momentGroups: Photo[][] = []
    for (const photo of group) {
      let placed = false
      for (const mg of momentGroups) {
        const last = mg[mg.length - 1]
        if (photo.meta.takenAt - last.meta.takenAt > BURST_GAP_MS) continue
        if (mg.some((m) => similar(m, photo))) {
          mg.push(photo)
          placed = true
          break
        }
      }
      if (!placed) momentGroups.push([photo])
    }

    momentGroups.forEach((mg, mIndex) => {
      const clusterId = `${sessionId}-m${mIndex}`
      const sorted = [...mg].sort(sortByTime)
      const overrideId = heroOverrides[clusterId]
      const override = overrideId ? sorted.find((p) => p.id === overrideId) : undefined
      const hero = override ?? [...sorted].sort((a, b) => heroScore(b) - heroScore(a))[0]
      const span = sorted[sorted.length - 1].meta.takenAt - sorted[0].meta.takenAt
      const kind: Cluster['kind'] =
        sorted.length === 1 ? 'single' : span <= 150_000 ? 'burst' : 'similar'
      const cluster: Cluster = {
        id: clusterId,
        sessionId,
        photoIds: sorted.map((p) => p.id),
        heroId: hero.id,
        kind,
        label: sorted.length === 1 ? 'Single' : `${sorted.length} shots`,
        detail: '',
      }
      const info = describeCluster(cluster, usable)
      cluster.detail = info.detail
      clusters.push(cluster)
      sorted.forEach((p) => {
        p.clusterId = clusterId
        p.sessionId = sessionId
        p.role =
          p.id === hero.id
            ? 'hero'
            : sorted.length === 1
              ? 'single'
              : distance(p, hero) <= 12 || coarseDistance(p.analysis!.coarse, hero.analysis!.coarse) < 0.06
                ? 'retake'
                : 'alt'
      })
    })
    group.forEach((p) => {
      p.sessionId = sessionId
    })
  })

  return { sessions, clusters }
}

export function tripStats(photos: Photo[], sessions: Session[], clusters: Cluster[]) {
  const ready = photos.filter((p) => p.status === 'ready')
  const kept = ready.filter((p) => p.role === 'hero' || p.role === 'single')
  const retakes = ready.filter((p) => p.role === 'retake').length
  const days = new Set(ready.map((p) => new Date(p.meta.takenAt).toDateString())).size
  const span =
    ready.length > 1
      ? Math.max(...ready.map((p) => p.meta.takenAt)) - Math.min(...ready.map((p) => p.meta.takenAt))
      : 0
  return {
    total: ready.length,
    kept: kept.length,
    retakes,
    sessions: sessions.length,
    clusters: clusters.length,
    days,
    hours: Math.round(span / 3_600_000),
    saving: ready.length ? Math.round((retakes / ready.length) * 100) : 0,
  }
}
