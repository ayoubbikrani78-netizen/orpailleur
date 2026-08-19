import { useState } from 'react'

/** Sélecteur Catégorie -> Sous-catégorie, avec possibilité de créer une nouvelle catégorie. */
export default function CategoryPicker({ categories, univers, famille, onChange }) {
  const universDistincts = [...new Set(categories.map((c) => c.univers))].sort()
  const famillesDisponibles = [...new Set(categories.filter((c) => c.univers === univers).map((c) => c.famille))].sort()
  const [nouvelUnivers, setNouvelUnivers] = useState(false)
  const [nouvelleFamille, setNouvelleFamille] = useState(false)

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Catégorie</label>
        {nouvelUnivers ? (
          <input autoFocus className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Nouvelle catégorie" value={univers} onChange={(e) => onChange(e.target.value, famille)} onBlur={() => !univers && setNouvelUnivers(false)} />
        ) : (
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={univers || ''} onChange={(e) => {
            if (e.target.value === '__nouveau__') { setNouvelUnivers(true); onChange('', ''); return }
            onChange(e.target.value, '')
          }}>
            <option value="">—</option>
            {universDistincts.map((u) => <option key={u} value={u}>{u}</option>)}
            <option value="__nouveau__">+ Nouvelle catégorie...</option>
          </select>
        )}
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Sous-catégorie</label>
        {nouvelleFamille ? (
          <input autoFocus className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Nouvelle sous-catégorie" value={famille} onChange={(e) => onChange(univers, e.target.value)} onBlur={() => !famille && setNouvelleFamille(false)} />
        ) : (
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={famille || ''} disabled={!univers} onChange={(e) => {
            if (e.target.value === '__nouveau__') { setNouvelleFamille(true); onChange(univers, ''); return }
            onChange(univers, e.target.value)
          }}>
            <option value="">—</option>
            {famillesDisponibles.map((f) => <option key={f} value={f}>{f}</option>)}
            <option value="__nouveau__">+ Nouvelle sous-catégorie...</option>
          </select>
        )}
      </div>
    </div>
  )
}

/** Version compacte (une ligne) du même sélecteur, pour les listes denses (ex: nouveaux produits sur une facture). */
export function CategoryPickerCompact({ categories, univers, famille, onChange }) {
  const universDistincts = [...new Set(categories.map((c) => c.univers))].sort()
  const famillesDisponibles = [...new Set(categories.filter((c) => c.univers === univers).map((c) => c.famille))].sort()
  return (
    <div className="flex items-center gap-1.5">
      <select className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-gray-600 bg-white" value={univers || ''} onChange={(e) => onChange(e.target.value, '')}>
        <option value="">Catégorie...</option>
        {universDistincts.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <select className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-gray-600 bg-white" value={famille || ''} disabled={!univers} onChange={(e) => onChange(univers, e.target.value)}>
        <option value="">Sous-catégorie...</option>
        {famillesDisponibles.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
    </div>
  )
}
