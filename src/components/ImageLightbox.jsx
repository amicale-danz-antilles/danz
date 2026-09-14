import { useEffect } from 'react'
import '../image-lightbox.css'

export default function ImageLightbox({ src, alt = 'Image de couverture', onClose }) {
  useEffect(() => {
    if (!src) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [src, onClose])

  if (!src) return null

  return <div className="image-lightbox" role="presentation" onClick={() => onClose?.()}>
    <div className="image-lightbox-shell" role="dialog" aria-modal="true" aria-label="Image de couverture agrandie" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="image-lightbox-close" aria-label="Fermer l’image" onClick={() => onClose?.()}>×</button>
      <img src={src} alt={alt} />
    </div>
  </div>
}
