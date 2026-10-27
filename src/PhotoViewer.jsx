// The photo you took: first the captured view while Replicate develops it, then the finished
// photograph with a download button.
// shot: { status: 'developing' | 'done' | 'error', capture, image, error, name }
export default function PhotoViewer({ shot, onClose }) {
  const developing = shot.status === 'developing'
  const done = shot.status === 'done'
  const title = done ? 'Your photo' : developing ? 'Developing your photo…' : "The photo didn't develop"

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="viewer-card">
        <h2>{title}</h2>
        <div className="viewer-frame">
          <img src={done ? shot.image : shot.capture} className={developing ? 'developing' : ''} alt={done ? 'The rendered photograph' : 'The view you captured'} />
          {developing && (
            <div className="viewer-progress" aria-hidden="true">
              <span />
            </div>
          )}
        </div>
        {developing && <p className="note">Replicate is turning your view into a photograph. This usually takes 10 to 30 seconds.</p>}
        {shot.status === 'error' && <p className="error">{shot.error}</p>}
        <div className="viewer-actions">
          {done && (
            <a className="aqua-button" href={shot.image} download={shot.name}>
              Download
            </a>
          )}
          <button className="glass-button" onClick={onClose}>
            {developing ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
