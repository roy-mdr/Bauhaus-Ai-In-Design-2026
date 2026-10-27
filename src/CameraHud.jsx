import { FOCAL_MM, EYE_HEIGHT_M } from './photo.js'

// The screen of a 2000s compact digital camera, laid over the view at eye level: frame corners,
// a grid, focus brackets, shooting settings, a battery, an orange date stamp and a shutter button.
// The shutter calls onShutter; each new flashKey fires the white flash once.

const pad = (n) => String(n).padStart(2, '0')

function Battery() {
  return (
    <svg className="hud-battery" viewBox="0 0 30 14" aria-label="Battery full">
      <rect x="1" y="1" width="25" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="26.5" y="4.5" width="2.5" height="5" fill="currentColor" />
      {[0, 1, 2].map((k) => (
        <rect key={k} x={3.2 + k * 7.4} y="3.2" width="6.2" height="7.6" fill="currentColor" />
      ))}
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg className="hud-icon" viewBox="0 0 24 18" aria-hidden="true">
      <path d="M2 5h5l2-3h6l2 3h5v11H2z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

// standing: how high the citizen stands above the ground, in metres (0 on the street).
export default function CameraHud({ standing = 0, shots = 128, busy = false, flashKey = 0, onShutter, onExit }) {
  const now = new Date()
  const stamp = `'${pad(now.getFullYear() % 100)} ${pad(now.getMonth() + 1)} ${pad(now.getDate())}`

  return (
    <div className="hud" aria-label="Camera view">
      <div className="hud-vignette" />
      <div className="hud-grid" />
      {['tl', 'tr', 'bl', 'br'].map((c) => (
        <div key={c} className={`hud-corner ${c}`} />
      ))}
      <div className="hud-af">
        <span className="hud-af-box" />
      </div>

      <div className="hud-top-left">
        <span className="hud-mode">P</span>
        <CameraIcon />
        <span>4M</span>
        <span className="hud-fine">FINE</span>
        <span>[{String(shots).padStart(4, '0')}]</span>
      </div>
      <div className="hud-top-right">
        <span>⚡A</span>
        <span>AWB</span>
        <Battery />
      </div>

      <div className="hud-exposure" aria-hidden="true">
        <span>-2</span>
        <span className="hud-scale">
          <i />
          <i />
          <i className="mark" />
          <i />
          <i />
        </span>
        <span>+2</span>
      </div>

      <div className="hud-bottom-left">
        <span>1/250</span>
        <span>F2.8</span>
        <span>ISO 100</span>
        <span>{FOCAL_MM}mm</span>
        <span className="hud-note">eye {(standing + EYE_HEIGHT_M).toFixed(standing ? 1 : 2)} m</span>
      </div>
      <div className="hud-date">{stamp}</div>

      <div className="hud-controls">
        <button className="hud-shutter" aria-label="Take picture" title="Take picture" disabled={busy} onClick={onShutter}>
          <span />
        </button>
        <span className="hud-caption">{busy ? 'Developing…' : 'Take picture'}</span>
      </div>
      <button className="hud-exit" onClick={onExit}>
        ◀ Back to map
      </button>
      <p className="hud-hint">Drag to look around · click a spot, bridge or terrace to go there</p>
      {flashKey > 0 && <div key={flashKey} className="hud-flash" />}
    </div>
  )
}
