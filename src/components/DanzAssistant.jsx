import { useState } from 'react'
export default function DanzAssistant() {
  const [open, setOpen] = useState(false)
  return <button onClick={() => setOpen(!open)}>{open ? 'Fermer' : 'Assistant DANZ'}</button>
}
