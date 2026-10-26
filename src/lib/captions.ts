import type { Photo, Session } from './types'

export interface CaptionSet {
  short: string
  playful: string
  story: string
  hashtags: string[]
  altTexts: { photoId: string; text: string }[]
  vibe: { name: string; traits: string[] }
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]
}

interface Vibe {
  id: 'coast' | 'city' | 'nature' | 'golden' | 'night' | 'mixed'
  name: string
  traits: string[]
  words: string[]
}

function detectVibe(photos: Photo[], sessions: Session[]): Vibe {
  const analysed = photos.filter((p) => p.analysis)
  if (!analysed.length) {
    return { id: 'mixed', name: 'Mixed bag', traits: ['varied scenes'], words: ['odds and ends', 'miscellaneous magic'] }
  }
  const hue = new Array(12).fill(0)
  let sky = 0
  let sat = 0
  let people = 0
  for (const p of analysed) {
    p.analysis!.hist.forEach((v, i) => (hue[i] += v))
    sky += p.analysis!.skyFraction
    sat += p.analysis!.saturation
    people += p.analysis!.people.length
  }
  const n = analysed.length
  sky /= n
  sat /= n
  const blue = hue[6] + hue[7] + hue[8] + hue[9] // 180-300°
  const green = hue[3] + hue[4]
  const warm = hue[0] + hue[1] + hue[11]
  const nightSessions = sessions.filter((s) => new Date(s.start).getHours() >= 20 || new Date(s.start).getHours() < 6).length

  if (sky > 0.36 && blue > 0.28 && green < 0.35) {
    return {
      id: 'coast',
      name: 'Coastal',
      traits: ['big skies', 'water', 'salt in everything'],
      words: ['sea air', 'salt and light', 'the blue hour'],
    }
  }
  if (nightSessions > 0 && nightSessions >= sessions.length * 0.4) {
    return {
      id: 'night',
      name: 'After dark',
      traits: ['late nights', 'city glow'],
      words: ['after-dark energy', 'one more drink', 'the late shift'],
    }
  }
  if (green > 0.4 && sky < 0.3) {
    return {
      id: 'nature',
      name: 'Green escape',
      traits: ['hills', 'walking', 'quiet'],
      words: ['the long way round', 'trees and trails', 'out of signal'],
    }
  }
  if (people >= Math.max(2, n * 0.35) && sky < 0.35) {
    return {
      id: 'city',
      name: 'Street level',
      traits: ['crowds', 'walls', 'walking'],
      words: ['side streets', 'wandering', 'getting lost on purpose'],
    }
  }
  if (warm > 0.34) {
    return {
      id: 'golden',
      name: 'Golden hour',
      traits: ['low sun', 'warm tones'],
      words: ['golden hour', 'that light', 'the good light'],
    }
  }
  return {
    id: 'mixed',
    name: 'Everything at once',
    traits: ['varied scenes', 'no fixed plan'],
    words: ['no fixed plan', 'all over the place', 'a bit of everything'],
  }
}

function describePhoto(p: Photo, index: number, total: number) {
  const a = p.analysis
  const parts: string[] = []
  parts.push(`Photo ${index + 1} of ${total}`)
  if (!a) return parts.join(' — ')
  const tod = new Date(p.meta.takenAt)
  const h = tod.getHours()
  const light = h < 7 ? 'early-morning' : h < 11 ? 'morning' : h < 16 ? 'midday' : h < 19 ? 'golden-hour' : 'after-dark'
  const scene =
    a.skyFraction > 0.3
      ? 'wide sky over the horizon'
      : a.people.length
        ? `${a.people.length === 1 ? 'a person' : `${a.people.length} people`} in the frame`
        : a.colorfulness > 45
          ? 'a colourful close scene'
          : 'a quiet scene'
  parts.push(`${light} ${scene}`)
  if (Math.abs(a.tiltDeg) >= 1.5) parts.push(`horizon corrected ${Math.abs(a.tiltDeg).toFixed(1)}°`)
  if (a.scores.sharpness > 65) parts.push('tack sharp')
  if (a.clippedHighlights > 0.05) parts.push('bright highlights')
  return parts.join(' · ')
}

export function generateCaptions(photos: Photo[], sessions: Session[], stats: { total: number; days: number; kept: number }): CaptionSet {
  const vibe = detectVibe(photos, sessions)
  const seed = stats.kept * 7919 + vibe.id.length * 131 + Math.round((sessions[0]?.start ?? 0) / 1000)
  const rng = mulberry32(seed)
  const days = Math.max(1, stats.days)
  const frames = Math.max(1, stats.kept)
  const dayWord = days === 1 ? 'one day' : `${days} days`

  const shortOptions = [
    `${plural(frames, 'frame')}, ${dayWord}, ${pick(rng, vibe.words)}.`,
    `${vibe.name} dump. ${cap(dayWord)}. No notes.`,
    `${cap(dayWord)} of ${pick(rng, vibe.words)} — ${frames} kept.`,
    `Kept ${frames} of ${plural(stats.total, 'photo')}. That's the edit.`,
  ]
  const playfulOptions = [
    `I took ${plural(stats.total, 'photo')} so you get the ${frames} good ones. ${cap(
      pick(rng, vibe.words),
    )}, mostly.`,
    `POV: me saying "one more photo" for ${dayWord}. Swipe for the ones that survived the cull.`,
    `Photo dump audit: ${plural(stats.total, 'shot')}, ${stats.total - frames} binned, ${frames} kept. ${cap(
      pick(rng, vibe.words),
    )}.`,
    `Certified ${vibe.name.toLowerCase()} dump. ${pick(rng, vibe.traits)}. ${frames} frames, zero regrets.`,
  ]
  const storyOptions = [
    `${cap(pick(rng, vibe.words))}. ${cap(dayWord)} — ${plural(sessions.length, 'stop')}, ${frames} frames I actually like.`,
    `Started with no plan and came back with ${plural(stats.total, 'photo')}. These ${frames} are the ones that felt like the trip: ${vibe.traits.join(', ')}.`,
    `${vibe.name}, in ${frames} frames. ${sessions
      .slice(0, 3)
      .map((s) => s.title.split(' · ')[0])
      .join(' → ')}.`,
  ]

  const baseTags = ['#photodump', '#holidaydump', '#traveldiary', `#${vibe.id === 'mixed' ? 'weekendtrip' : 'travel'}`, '#shotoniphone']
  const vibeTags: Record<Vibe['id'], string[]> = {
    coast: ['#coastallife', '#seaside', '#oceanside', '#goldenhour'],
    city: ['#streetphotography', '#citybreak', '#urbanphotography', '#weekendescape'],
    nature: ['#outdoors', '#hiking', '#slowliving', '#mountainviews'],
    golden: ['#goldenhour', '#sunsetchaser', '#warmtones'],
    night: ['#afterdark', '#nightshots', '#citylights'],
    mixed: ['#travelmore', '#wanderlust', '#makethemostofit'],
  }
  const hashtags = [...new Set([...baseTags, ...vibeTags[vibe.id]])].slice(0, 10)

  const altTexts = photos.slice(0, 30).map((p, i) => ({ photoId: p.id, text: describePhoto(p, i, photos.length) }))

  return {
    short: pick(rng, shortOptions),
    playful: pick(rng, playfulOptions),
    story: pick(rng, storyOptions),
    hashtags,
    altTexts,
    vibe: { name: vibe.name, traits: vibe.traits },
  }
}
