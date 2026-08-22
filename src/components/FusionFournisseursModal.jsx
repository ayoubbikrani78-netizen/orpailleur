import { useEffect, useState } from 'react'
import { detecterGroupesDoublons, fusionnerFournisseurs } from '../lib/regroupementFournisseurs'
import { X, CheckCircle2, Merge } from 'lucide-react'

export default function FusionFournisseursModal({ fournisseurs, onClose, onDone }) {
  const [groupes, setGroupes] = useState([])
  const [canoniques, setCanoniques] = useState({}) // groupeIndex -> id du fournisseur conservé
  const [traites, setTraites] = useState(new Set())
  const [fusion, setFusion] = useState(null)

  useEffect(() => {
    const g = detecterGroupesDoublons(fournisseurs)
    setGroupes(g)
    // Par défaut, on garde celui avec le plus de factures (le plus "établi")
    const defauts = {}
    g.forEach((groupe, i) => {
      const meilleur = [...groupe].sort((a, b) => (b.nb_factures || 0) - (a.nb_factures || 0))[0]
      defauts[i] = meilleur.id
    })
    setCanoniques(defauts)
  }, [fournisseurs])

  async function fusionnerGroupe(index) {
    const groupe = groupes[index]
    const idCanonique = canoniques[index]
    const canonique = groupe.find((f) => f.id === idCanonique)
    const doublons = groupe.filter((f) => f.id !== idCanonique)
    setFusion(index)
    try {
      await fusionnerFournisseurs(canonique, doublons)
      setTraites(new Set([...traites, index]))
    } finally {
      setFusion(null)
    }
  }

  const restants = groupes.map((g, i) => i).filter((i) => !traites.has(i))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-bold text-gray-800">Doublons de fournisseurs</h3>
            <p className="text-xs text-gray-400 mt-0.5">{groupes.length} groupe(s) détecté(s)</p>
          </div>
          <button onClick={() => { onDone(); onClose() }}><X size={20} className="text-gray-400" /></button>
        </div>

        <div className="px-8 py-6 overflow-y-auto flex-1">
          {groupes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle2 size={32} className="text-green-500 mb-3" />
              <p className="text-sm text-gray-600">Aucun doublon détecté.</p>
            </div>
          ) : restants.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle2 size={32} className="text-green-500 mb-3" />
              <p className="text-sm text-gray-600">Tous les doublons ont été fusionnés.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {restants.map((i) => {
                const groupe = groupes[i]
                return (
                  <div key={i} className="border border-gray-200 rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Fiche conservée (les autres seront supprimées, leurs factures/commandes réassignées) :</p>
                    <div className="space-y-1.5 mb-3">
                      {groupe.map((f) => (
                        <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            checked={canoniques[i] === f.id}
                            onChange={() => setCanoniques({ ...canoniques, [i]: f.id })}
                          />
                          <span className={canoniques[i] === f.id ? 'font-semibold text-gray-800' : 'text-gray-500'}>{f.nom}</span>
                          <span className="text-xs text-gray-400">({f.nb_factures || 0} facture{f.nb_factures > 1 ? 's' : ''})</span>
                        </label>
                      ))}
                    </div>
                    <button
                      onClick={() => fusionnerGroupe(i)}
                      disabled={fusion === i}
                      className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-white text-xs font-medium disabled:opacity-50"
                      style={{ backgroundColor: '#C9A84C' }}
                    >
                      <Merge size={13} /> {fusion === i ? 'Fusion...' : `Fusionner ces ${groupe.length} fiches`}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end px-8 py-4 border-t border-gray-100">
          <button onClick={() => { onDone(); onClose() }} className="px-6 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
            {restants.length === 0 ? 'Terminer' : 'Fermer'}
          </button>
        </div>
      </div>
    </div>
  )
}
