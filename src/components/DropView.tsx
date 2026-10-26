import { useRef, useState } from 'react'
import { ImagePlus, Sparkles, Upload, Wand2, Layers, Crop, Eraser, Users, Zap, MonitorDown } from 'lucide-react'
import { useStore } from '../lib/store'
import { getBridge } from '../lib/ai/bridge'

export function DropView() {
  const inputRef = useRef<HTMLInputElement>(null)
  const addFiles = useStore((s) => s.addFiles)
  const loadDemo = useStore((s) => s.loadDemo)
  const [drag, setDrag] = useState(false)
  const [loadingDemo, setLoadingDemo] = useState(false)

  const bridge = getBridge()

  const onFiles = async (files: FileList | File[] | null) => {
    if (!files) return
    await addFiles(Array.from(files))
  }

  const pick = async () => {
    if (!bridge) {
      inputRef.current?.click()
      return
    }
    const picked = await bridge.files.openImages()
    if (!picked.length) return
    await addFiles(picked.map((f) => new File([f.data], f.name, { type: f.type, lastModified: f.lastModified })))
  }

  return (
    <div
      className="drop-view"
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        onFiles(e.dataTransfer.files)
      }}
    >
      <div className="hero">
        <div>
          <div className="eyebrow">
            <Sparkles size={12} /> holiday dump · ig ready
          </div>
          <h2>
            Every photo from the trip,
            <br />
            <em>already sorted.</em>
          </h2>
          <p className="lead">
            Drop the whole camera roll. Insta Buddy groups shots into moments, picks the keeper from every burst and
            retake, then suggests the touch-ups you'd actually make — straighten, level the horizon, remove wires,
            remove people, crop, extend, sharpen.
          </p>
          <div className="hero-actions">
            <button className="btn primary" onClick={pick}>
              <Upload size={15} /> Choose photos
            </button>
            <button
              className="btn"
              disabled={loadingDemo}
              onClick={async () => {
                setLoadingDemo(true)
                await loadDemo()
                setLoadingDemo(false)
              }}
            >
              {loadingDemo ? <span className="spinner" /> : <Wand2 size={15} />}
              {loadingDemo ? 'Painting demo trip…' : 'Try a demo trip'}
            </button>
          </div>
          <div className="trust-row">
            <span>
              <Layers size={12} /> groups bursts
            </span>
            <span>
              <Zap size={12} /> picks keepers
            </span>
            <span>
              <Eraser size={12} /> removes wires
            </span>
            <span>
              <Users size={12} /> clears strangers
            </span>
            <span>
              <Crop size={12} /> crops & extends
            </span>
          </div>
        </div>

        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            onFiles(e.dataTransfer.files)
          }}
        >
          <div className="dz-icon">
            <ImagePlus size={24} />
          </div>
          <h3>{drag ? 'Drop them here' : 'Drag your photos in'}</h3>
          <p>JPEG, PNG or WebP · HEIC will fall back to whatever your browser can decode</p>
          <button className="btn" onClick={pick}>
            <Upload size={14} /> Browse files
          </button>
          {bridge && (
            <div className="desktop-badge" style={{ justifyContent: 'center', marginTop: 8 }}>
              <MonitorDown size={11} /> desktop app · native file picker, encrypted keys, no CORS
            </div>
          )}
          <div className="dz-stats">
            <div>
              <b>0 uploads</b>
              <small>stays on device</small>
            </div>
            <div>
              <b>~60 ms</b>
              <small>per photo</small>
            </div>
            <div>
              <b>1 zip</b>
              <small>captions + grid</small>
            </div>
          </div>
          <p className="demo-link">
            Nothing to hand? <button onClick={() => loadDemo()}>Paint a demo trip</button> and poke around.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
