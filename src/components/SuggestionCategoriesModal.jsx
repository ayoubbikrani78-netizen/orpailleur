import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { suggererCategoriesEnMasse } from '../lib/categoriser'
import CategoryPicker from './CategoryPicker'
import { X, Loader2, CheckCircle2 } from 'lucide-react'

export default function SuggestionCategoriesModal({ matieres, categories, onClose, onDone }) {
  const [step, setStep] = useState('confirm') // confirm | loading | review | saving
  const [erreur, setErreur] = useState('')
  const [lignes, setLignes] = useState([])

  async function lancer() {
    setStep('loading')
    setErreur('')
    try {
      const suggestions = await suggererCategoriesEnMasse(matieres.map((m) => m.designation_interne))
      const parDesignation = Object.fromEntries(suggestions.map((s) => [s.designation.trim().toLowerCase(), s]))
      setLignes(matieres.map((m) => {
        const s = parDesignation[m.designation_interne.trim().toLowerCase()]
        const universValide = s && categories.some((c) => c.univers === s.univers_suggere) ? s.univers_suggere : ''
        const familleValide = s && categories.some((c) => c.univers === universValide && c.famille === s.famille_suggere) ? s.famille_suggere : ''
        return { id: m.id, designation: m.designation_interne, univers: universValide, famille: familleValide }
      }))
      setStep('review')
    } catch (e) {
      setErreur(e.message)
      setStep('confirm')
    }
  }

  function updateLigne(id, univers, famille) {
    setLignes(lignes.map((l) => (l.id === id ? { ...l, univers, famille } : l)))
  }

  async function appliquer() {
    setStep('saving')
    const aAppliquer = lignes.filter((l) => l.univers && l.famille)
    for (const l of aAppliquer) {
      await supabase.from('matieres_premieres').update({ univers: l.univers, famille: l.famille }).eq('id', l.id)
    }
    onDone()
    onClose()
  }

  const nbPrets = lignes.filter((l) => l.univers && l.famille).length

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-bold text-gray-800">Suggestion de catégories</h3>
            <p className="text-xs text-gray-400 mt-0.5">{matieres.length} article(s) non catégorisé(s)</p>
          </div>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>

        <div className="px-8 py-6 overflow-y-auto flex-1">
          {erreur && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{erreur}</div>}

          {step === 'confirm' && (
            <div className="text-center py-10">
              <p className="text-sm text-gray-600 mb-6">
                L'IA va proposer une catégorie pour chacun de tes {matieres.length} articles non catégorisés, à partir de leur nom.
                Tu valides ou corriges chaque ligne avant que rien ne soit enregistré.
              </p>
              <button onClick={lancer} className="px-6 py-2.5 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
                Lancer la suggestion
              </button>
            </div>
          )}

          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
              <Loader2 size={28} className="animate-spin" />
              <p className="text-sm">Analyse de {matieres.length} articles en cours...</p>
            </div>
          )}

          {(step === 'review' || step === 'saving') && (
            <div className="space-y-2">
              {lignes.map((l) => (
                <div key={l.id} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-700 flex-1 truncate">{l.designation}</span>
                  <div className="w-80 shrink-0">
                    <CategoryPicker categories={categories} univers={l.univers} famille={l.famille} onChange={(u, f) => updateLigne(l.id, u, f)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {(step === 'review' || step === 'saving') && (
          <div className="flex items-center justify-between px-8 py-4 border-t border-gray-100">
            <p className="text-xs text-gray-400">{nbPrets} / {lignes.length} prêt(e)s à être appliquées</p>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500">Annuler</button>
              <button
                onClick={appliquer}
                disabled={step === 'saving' || nbPrets === 0}
                className="flex items-center gap-2 px-6 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: '#C9A84C' }}
              >
                {step === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Appliquer ({nbPrets})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
