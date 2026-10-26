import exifr from 'exifr'
import type { Gps, PhotoMeta } from './types'

interface RawExif {
  DateTimeOriginal?: Date
  CreateDate?: Date
  ModifyDate?: Date
  Make?: string
  Model?: string
  LensModel?: string
  ISO?: number
  FNumber?: number
  ExposureTime?: number
  FocalLength?: number
  latitude?: number
  longitude?: number
}

export async function readExif(file: File): Promise<Partial<PhotoMeta>> {
  try {
    const raw = (await exifr.parse(file, {
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'ModifyDate',
        'Make',
        'Model',
        'LensModel',
        'ISO',
        'FNumber',
        'ExposureTime',
        'FocalLength',
      ],
      gps: true,
      translateValues: false,
      reviveValues: true,
    })) as RawExif | undefined
    if (!raw) return {}
    const when = raw.DateTimeOriginal ?? raw.CreateDate ?? raw.ModifyDate
    const gps: Gps | undefined =
      typeof raw.latitude === 'number' && typeof raw.longitude === 'number'
        ? { lat: raw.latitude, lon: raw.longitude }
        : undefined
    const camera = [raw.Make?.trim(), raw.Model?.trim()].filter(Boolean).join(' ') || undefined
    return {
      takenAt: when instanceof Date ? when.getTime() : undefined,
      takenAtSource: when ? 'exif' : undefined,
      gps,
      camera,
      lens: raw.LensModel?.trim() || undefined,
      iso: typeof raw.ISO === 'number' ? raw.ISO : undefined,
      fNumber: typeof raw.FNumber === 'number' ? raw.FNumber : undefined,
      exposureTime: typeof raw.ExposureTime === 'number' ? raw.ExposureTime : undefined,
      focalLength: typeof raw.FocalLength === 'number' ? raw.FocalLength : undefined,
    }
  } catch {
    return {}
  }
}
