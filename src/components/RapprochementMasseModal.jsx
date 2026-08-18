import { useEffect, useState } from 'react'
import { listerIngredientsEnAttenteGroupes, appliquerRapprochementGroupe } from '../lib/importRecette'
import { X, Loader2, CheckCircle2, ChevronDown } from 'lucide-react'

export default function RapprochementMasseModal({ onClose, onDone }) {
  const [loading, setLoading] = useState(true)
  const [groupes, setGroupes] = useState([])
  const [matieres, setMatieres] = useState([])
  const [traites, setTraites] = useState({}) // designation -> true une fois appliqué

  useEffect(() => { charger() }, [])

  async function charger() {
    setLoading(true)
    const { groupes: g, matieres: m } = await listerIngredientsEnAttenteGroupes()
    setGroupes(g)
    setMatieres(m)
    setLoading(false)
  }

  async function appliquer(groupe, matierePremiereId) {
    if (!matierePremiereId) return
    await appliquerRapprochementGroupe(groupe.ids, matierePremiereId)
    setTraites({ ...traites, [groupe.designation]: true })
  }

  const restants = groupes.filter((g) => !traites[g.designation])
  const nbRecettesTouchees = groupes.reduce((s, g) => s + g.ids.length, 0)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-bold text-gray-800">Rapprochement groupé</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {loading ? 'Analyse en cours...' : `${groupes.length} désignation(s) unique(s), ${nbRecettesTouchees} ligne(s) de recette au total`}
            </p>
          </div>
          <button onClick={() => { onDone(); onClose() }}><X size={20} className="text-gray-400" /></button>
        </div>

        <div className="px-8 py-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
              <Loader2 size={20} className="animate-spin" /> Chargement...
            </div>
          ) : restants.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle2 size={32} className="text-green-500 mb-3" />
              <p className="text-sm text-gray-600">Tout est rapproché !</p>
            </div>
          ) : (
            <div className="space-y-3">
              {restants.map((groupe) => (
                <GroupeLigne key={groupe.designation} groupe={groupe} matieres={matieres} onAppliquer={(mpId) => appliquer(groupe, mpId)} />
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end px-8 py-4 border-t border-gray-100">
          <button onClick={() => { onDone(); onClose() }} className="px-6 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
            {restants.length === 0 ? 'Terminer' : 'Fermer et continuer plus tard'}
          </button>
        </div>
      </div>
    </div>
  )
}

function GroupeLigne({ groupe, matieres, onAppliquer }) {
  const [ouvert, setOuvert] = useState(false)
  const [choix, setChoix] = useState('')

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
        <div>
          <p className="text-sm font-semibold text-gray-700">{groupe.designation}</p>
          <p className="text-[11px] text-gray-400">
            utilisé dans {groupe.ids.length} ligne{groupe.ids.length > 1 ? 's' : ''}
            {groupe.recettes.length > 0 && <> — {groupe.recettes.slice(0, 3).join(', ')}{groupe.recettes.length > 3 ? `, +${groupe.recettes.length - 3}` : ''}</>}
          </p>
        </div>
        <button onClick={() => setOuvert(!ouvert)} className="text-gray-400"><ChevronDown size={16} className={ouvert ? 'rotate-180' : ''} /></button>
      </div>

      {groupe.candidats.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-gray-100">
          {groupe.candidats.map((c) => (
            <button
              key={c.id}
              onClick={() => onAppliquer(c.id)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 text-gray-600 hover:border-yellow-400 hover:bg-yellow-50"
            >
              {c.designation_interne}
            </button>
          ))}
        </div>
      )}

      {(ouvert || groupe.candidats.length === 0) && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100">
          <select className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs" value={choix} onChange={(e) => setChoix(e.target.value)}>
            <option value="">{groupe.candidats.length === 0 ? 'Aucune suggestion — choisis manuellement...' : 'Ou choisis un autre article...'}</option>
            {matieres.map((m) => <option key={m.id} value={m.id}>{m.designation_interne}</option>)}
          </select>
          <button
            onClick={() => choix && onAppliquer(choix)}
            disabled={!choix}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: '#C9A84C' }}
          >
            Associer
          </button>
        </div>
      )}
    </div>
  )
}
