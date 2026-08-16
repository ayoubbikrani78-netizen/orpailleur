import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { extraireRecetteDeFichier, suggererMatierePremiere } from '../lib/importRecette'
import { uniteesCompatibles } from '../lib/coutRevient'
import { Upload, X, AlertTriangle, Loader2, Trash2, FileText } from 'lucide-react'

export default function ImporterRecetteModal({ matieres, ateliers, onClose, onImported }) {
  const [step, setStep] = useState('pick') // pick | loading | review | saving
  const [erreur, setErreur] = useState('')
  const [form, setForm] = useState({ nom: '', famille: '', atelier_id: '' })
  const [lignes, setLignes] = useState([])

  async function handleFile(file) {
    setErreur('')
    setStep('loading')
    try {
      const resultat = await extraireRecetteDeFichier(file)
      setForm({ nom: resultat.nomRecette, famille: resultat.famille, atelier_id: '' })
      setLignes(
        resultat.lignes.map((l) => {
          const suggestion = suggererMatierePremiere(l.designation, matieres)
          return {
            designationBrute: l.designation,
            quantite: l.quantite,
            unite: l.unite,
            matiere_premiere_id: suggestion?.id || '',
          }
        })
      )
      setStep('review')
    } catch (e) {
      setErreur(e.message)
      setStep('pick')
    }
  }

  function updateLigne(i, patch) {
    setLignes(lignes.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  function retirerLigne(i) {
    setLignes(lignes.filter((_, idx) => idx !== i))
  }

  const lignesAvecQuantite = lignes.filter((l) => l.quantite)
  const lignesValides = lignesAvecQuantite.filter((l) => l.matiere_premiere_id)
  const lignesIncompletes = lignesAvecQuantite.length - lignesValides.length

  async function confirmer() {
    if (!form.nom || !form.famille) return setErreur('Nom et famille sont obligatoires.')
    if (lignesAvecQuantite.length === 0) return setErreur('Ajoute au moins un ingrédient avec une quantité avant de valider.')
    setStep('saving')
    const { data: recette, error: errRecette } = await supabase.from('recettes').insert({
      nom: form.nom,
      famille: form.famille,
      atelier_id: form.atelier_id || null,
    }).select().single()
    if (errRecette) { setErreur(errRecette.message); setStep('review'); return }

    const { error: errIngredients } = await supabase.from('recette_ingredients').insert(
      lignesAvecQuantite.map((l) => ({
        recette_id: recette.id,
        matiere_premiere_id: l.matiere_premiere_id || null,
        designation_brute: l.matiere_premiere_id ? null : l.designationBrute,
        quantite: parseFloat(l.quantite),
        unite: l.unite,
      }))
    )
    if (errIngredients) { setErreur(errIngredients.message); setStep('review'); return }

    onImported(recette.id)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-800">Importer une recette</h3>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>

        <div className="px-8 py-6 overflow-y-auto flex-1">
          {erreur && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">
              <AlertTriangle size={14} /> {erreur}
            </div>
          )}

          {step === 'pick' && (
            <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-200 rounded-xl py-16 cursor-pointer hover:border-gray-300">
              <Upload size={28} className="text-gray-300" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600">Dépose ou choisis un fichier</p>
                <p className="text-xs text-gray-400 mt-1">.docx, .pdf, .xlsx ou .xls</p>
              </div>
              <input type="file" accept=".docx,.pdf,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
            </label>
          )}

          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
              <Loader2 size={28} className="animate-spin" />
              <p className="text-sm">Lecture du fichier en cours...</p>
            </div>
          )}

          {(step === 'review' || step === 'saving') && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Nom du produit</label>
                  <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Famille</label>
                  <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.famille} onChange={(e) => setForm({ ...form, famille: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Atelier</label>
                  <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.atelier_id} onChange={(e) => setForm({ ...form, atelier_id: e.target.value })}>
                    <option value="">—</option>
                    {ateliers.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <FileText size={14} className="text-gray-400" />
                <p className="text-xs text-gray-500">
                  {lignes.length} ligne{lignes.length > 1 ? 's' : ''} détectée{lignes.length > 1 ? 's' : ''}
                  {lignesIncompletes > 0 && <span className="text-orange-500"> — {lignesIncompletes} seront créées "en attente" (à rapprocher plus tard)</span>}
                </p>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      <th className="px-3 py-2">Extrait du fichier</th>
                      <th className="px-3 py-2">Matière première (Mercuriale)</th>
                      <th className="px-3 py-2 w-20">Qté</th>
                      <th className="px-3 py-2 w-20">Unité</th>
                      <th className="px-3 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((l, i) => {
                      const mpChoisie = l.matiere_premiere_id ? matieres.find((m) => m.id === l.matiere_premiere_id) : null
                      const options = mpChoisie ? uniteesCompatibles(mpChoisie.unite) : ['g', 'kg', 'ml', 'cl', 'L', 'pcs']
                      return (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-500 italic">{l.designationBrute}</td>
                          <td className="px-3 py-2">
                            <select
                              className={`w-full border rounded-lg px-2 py-1.5 text-xs ${l.matiere_premiere_id ? 'border-gray-200' : 'border-orange-300 bg-orange-50'}`}
                              value={l.matiere_premiere_id}
                              onChange={(e) => updateLigne(i, { matiere_premiere_id: e.target.value, unite: uniteesCompatibles(matieres.find((m) => m.id === e.target.value)?.unite)[0] || l.unite })}
                            >
                              <option value="">— à choisir —</option>
                              {matieres.map((m) => <option key={m.id} value={m.id}>{m.designation_interne}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs" value={l.quantite} onChange={(e) => updateLigne(i, { quantite: e.target.value })} />
                          </td>
                          <td className="px-3 py-2">
                            <select className="w-full border border-gray-200 rounded-lg px-1 py-1.5 text-xs" value={l.unite} onChange={(e) => updateLigne(i, { unite: e.target.value })}>
                              {options.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-2"><button onClick={() => retirerLigne(i)}><Trash2 size={13} className="text-gray-300 hover:text-red-500" /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-2">Les lignes surlignées en orange n'ont pas de correspondance automatique — choisis la matière première toi-même, ou laisse "— à choisir —" : la ligne sera créée en attente et rapprochée automatiquement dès qu'un article correspondant apparaîtra dans la Mercuriale.</p>
            </div>
          )}
        </div>

        {(step === 'review' || step === 'saving') && (
          <div className="flex justify-end gap-3 px-8 py-5 border-t border-gray-100">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500">Annuler</button>
            <button
              onClick={confirmer}
              disabled={step === 'saving'}
              className="flex items-center gap-2 px-6 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#C9A84C' }}
            >
              {step === 'saving' && <Loader2 size={14} className="animate-spin" />}
              Créer la recette ({lignesAvecQuantite.length} ingrédient{lignesAvecQuantite.length > 1 ? 's' : ''})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
