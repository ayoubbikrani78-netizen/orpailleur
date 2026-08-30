import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculerCoutRevient, resoudreCmup, uniteesCompatibles, quantiteEnBase } from '../lib/coutRevient'
import { X, Search, Trash2, Package, GripVertical, Loader2 } from 'lucide-react'

const EMPTY_FORM = {
  nom: '', atelier_id: '', qte_produit: 1, volume_prod: 1,
  tps_prepa_min: '', tps_cuisson_min: 0, packaging_u: 0, pv_ttc: '',
}

export default function AssemblageBuilderModal({ ateliers, onClose, onCreated }) {
  const [step, setStep] = useState('categorie') // categorie | assemblage
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recettes, setRecettes] = useState([])
  const [matieres, setMatieres] = useState([])
  const [elementsAll, setElementsAll] = useState([])
  const [ingredientsAll, setIngredientsAll] = useState([])
  const [bareme, setBareme] = useState([])
  const [perteDefaut, setPerteDefaut] = useState(0.08)

  const [familleChoisie, setFamilleChoisie] = useState('')
  const [nouvelleFamille, setNouvelleFamille] = useState('')
  const [query, setQuery] = useState('')
  const [basesDansRecette, setBasesDansRecette] = useState([]) // [{ baseId, quantite, unite }]
  const [survole, setSurvole] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: rec }, { data: mp }, { data: els }, { data: ings }, { data: bar }, { data: regl }] = await Promise.all([
      supabase.from('recettes').select('*').order('nom'),
      supabase.from('matieres_premieres').select('id, designation_interne, unite, cmp, poids_moyen_g'),
      supabase.from('recette_elements').select('*'),
      supabase.from('recette_ingredients').select('*'),
      supabase.from('bareme_energie').select('*'),
      supabase.from('reglages').select('perte_defaut').limit(1).maybeSingle(),
    ])
    setRecettes(rec || [])
    setMatieres(mp || [])
    setElementsAll(els || [])
    setIngredientsAll(ings || [])
    setBareme(bar || [])
    setPerteDefaut(regl?.perte_defaut ?? 0.08)
    setLoading(false)
  }

  const bases = useMemo(() => recettes.filter((r) => r.est_composant && r.matiere_premiere_id), [recettes])

  const ctx = useMemo(() => {
    const matieresById = Object.fromEntries(matieres.map((m) => [m.id, m]))
    const recettesParMpId = Object.fromEntries(
      recettes.filter((r) => r.est_composant && r.matiere_premiere_id).map((r) => [r.matiere_premiere_id, r])
    )
    const elementsParRecetteId = {}
    for (const el of elementsAll) (elementsParRecetteId[el.recette_id] ||= []).push(el)
    const ingredientsParElementId = {}
    const ingredientsDirectsParRecetteId = {}
    for (const ing of ingredientsAll) {
      if (ing.element_id) (ingredientsParElementId[ing.element_id] ||= []).push(ing)
      else if (ing.recette_id) (ingredientsDirectsParRecetteId[ing.recette_id] ||= []).push(ing)
    }
    const tauxHoraireParAtelier = Object.fromEntries(ateliers.map((a) => [a.id, a.taux_horaire]))
    return { matieresById, recettesParMpId, elementsParRecetteId, ingredientsParElementId, ingredientsDirectsParRecetteId, tauxHoraireParAtelier, bareme, perteDefaut }
  }, [matieres, recettes, elementsAll, ingredientsAll, ateliers, bareme, perteDefaut])

  // Uniquement les catégories des recettes finales (Pâtisserie, Snack...), jamais celles
  // des Bases et Appareils (Biscuit, Ganache...) qui ne sont pas des catégories de produit vendu.
  // Liste fixe des catégories de produits vendus (pas dérivée des données, pour rester stable
  // quoi qu'il arrive en base). "+ Nouvelle catégorie" reste disponible en dessous si besoin.
  const familles = ['Pâtisserie', 'Snack', 'Viennoiserie', 'Pain', 'Boisson', 'Pizza']

  const basesFiltrees = bases.filter((b) => b.nom.toLowerCase().includes(query.toLowerCase()))

  function ajouterBase(baseId) {
    if (basesDansRecette.some((b) => b.baseId === baseId)) return
    const base = bases.find((b) => b.id === baseId)
    const mp = matieres.find((m) => m.id === base?.matiere_premiere_id)
    setBasesDansRecette([...basesDansRecette, { baseId, quantite: base?.qte_produit || 1, unite: mp?.unite || 'g' }])
  }

  function retirerBase(baseId) {
    setBasesDansRecette(basesDansRecette.filter((b) => b.baseId !== baseId))
  }

  function updateLigne(baseId, patch) {
    setBasesDansRecette(basesDansRecette.map((b) => (b.baseId === baseId ? { ...b, ...patch } : b)))
  }

  // Coût matière prévisionnel = somme des bases assemblées, résolu récursivement (gère les bases composées d'autres bases)
  const lignesAvecCout = basesDansRecette.map((ligne) => {
    const base = bases.find((b) => b.id === ligne.baseId)
    const mp = matieres.find((m) => m.id === base?.matiere_premiere_id)
    let cmup = 0
    try { cmup = resoudreCmup(base?.matiere_premiere_id, ctx) } catch { cmup = 0 }
    const qteBase = quantiteEnBase(ligne.quantite, ligne.unite, mp?.unite)
    return { ...ligne, base, mp, cmup, coutLigne: qteBase * cmup }
  })

  const calcApercu = useMemo(() => {
    const recetteVirtuelle = {
      qte_produit: form.qte_produit, volume_prod: form.volume_prod,
      tps_prepa_min: form.tps_prepa_min, tps_cuisson_min: form.tps_cuisson_min, packaging_u: form.packaging_u,
    }
    const ingredientsDirects = lignesAvecCout.map((l) => ({ quantite: l.quantite, unite: l.unite, cmup: l.cmup, mp: l.mp }))
    return calculerCoutRevient(recetteVirtuelle, {
      tauxHoraire: ctx.tauxHoraireParAtelier[form.atelier_id] || 0,
      bareme, perteDefaut, elements: [], ingredientsDirects,
    })
  }, [form, lignesAvecCout, ctx, bareme, perteDefaut])

  async function creerRecette() {
    const famille = familleChoisie || nouvelleFamille.trim()
    if (!famille) return alert('Choisis ou saisis une catégorie')
    if (!form.nom.trim()) return alert('Donne un nom à ta recette')
    if (basesDansRecette.length === 0) return alert('Ajoute au moins une base ou un appareil')

    setSaving(true)
    const { data: recette, error } = await supabase.from('recettes').insert({
      nom: form.nom.trim(),
      famille,
      atelier_id: form.atelier_id || null,
      qte_produit: parseFloat(form.qte_produit) || 1,
      volume_prod: parseFloat(form.volume_prod) || 1,
      tps_prepa_min: form.tps_prepa_min === '' ? null : parseFloat(form.tps_prepa_min),
      tps_cuisson_min: parseFloat(form.tps_cuisson_min) || 0,
      packaging_u: parseFloat(form.packaging_u) || 0,
      pv_ttc: form.pv_ttc === '' ? null : parseFloat(form.pv_ttc),
    }).select().single()

    if (error) { alert(`Échec : ${error.message}`); setSaving(false); return }

    const { error: errIng } = await supabase.from('recette_ingredients').insert(
      basesDansRecette.map((l) => {
        const base = bases.find((b) => b.id === l.baseId)
        return {
          recette_id: recette.id,
          matiere_premiere_id: base.matiere_premiere_id,
          quantite: parseFloat(l.quantite) || 0,
          unite: l.unite,
        }
      })
    )
    if (errIng) { alert(`Échec (ingrédients) : ${errIng.message}`); setSaving(false); return }

    onCreated(recette.id)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-bold text-gray-800">Nouvelle recette — assemblage</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'categorie' ? 'Choisis la catégorie de ta recette' : `${familleChoisie || nouvelleFamille} — glisse tes bases et appareils à droite`}
            </p>
          </div>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400 gap-2"><Loader2 size={20} className="animate-spin" /> Chargement...</div>
        ) : step === 'categorie' ? (
          <div className="px-8 py-8 overflow-y-auto flex-1">
            <div className="grid grid-cols-3 gap-3 mb-6">
              {familles.map((f) => (
                <button
                  key={f}
                  onClick={() => { setFamilleChoisie(f); setStep('assemblage') }}
                  className="border border-gray-200 rounded-xl px-4 py-6 text-center hover:border-yellow-400 hover:bg-yellow-50 transition-colors"
                >
                  <span className="font-medium text-gray-700">{f}</span>
                  <p className="text-xs text-gray-400 mt-1">{recettes.filter((r) => !r.est_composant && r.famille === f).length} recette(s) existante(s)</p>
                </button>
              ))}
            </div>
            <div className="border-t border-gray-100 pt-6">
              <label className="text-xs font-medium text-gray-500 mb-1 block">Ou crée une nouvelle catégorie</label>
              <div className="flex gap-2">
                <input className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Nom de la catégorie" value={nouvelleFamille} onChange={(e) => setNouvelleFamille(e.target.value)} />
                <button
                  onClick={() => { setFamilleChoisie(''); setStep('assemblage') }}
                  disabled={!nouvelleFamille.trim()}
                  className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
                  style={{ backgroundColor: '#C9A84C' }}
                >
                  Continuer
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Colonne gauche : bases disponibles */}
            <div className="w-72 border-r border-gray-100 flex flex-col">
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <Search size={14} className="text-gray-400" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher..." className="flex-1 text-sm bg-transparent outline-none" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {basesFiltrees.length === 0 && <p className="text-xs text-gray-400 px-2">Aucune base disponible. Crée-en depuis "Base et Appareils".</p>}
                {basesFiltrees.map((base) => {
                  const dejaAjoutee = basesDansRecette.some((b) => b.baseId === base.id)
                  return (
                    <div
                      key={base.id}
                      draggable={!dejaAjoutee}
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', base.id)}
                      onClick={() => !dejaAjoutee && ajouterBase(base.id)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm ${dejaAjoutee ? 'opacity-40 cursor-not-allowed border-gray-100' : 'cursor-grab active:cursor-grabbing border-gray-200 hover:border-yellow-400 hover:bg-yellow-50'}`}
                    >
                      <GripVertical size={14} className="text-gray-300 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-700 truncate">{base.nom}</p>
                        <p className="text-[10px] text-gray-400">{base.famille}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Colonne droite : zone de dépôt + formulaire */}
            <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
              <div className="p-6 space-y-4">
                <input
                  placeholder="Nom de la recette"
                  className="w-full text-lg font-semibold border-b border-gray-200 pb-2 outline-none focus:border-yellow-400"
                  value={form.nom}
                  onChange={(e) => setForm({ ...form, nom: e.target.value })}
                />

                <div
                  onDragOver={(e) => { e.preventDefault(); setSurvole(true) }}
                  onDragLeave={() => setSurvole(false)}
                  onDrop={(e) => { e.preventDefault(); setSurvole(false); const id = e.dataTransfer.getData('text/plain'); if (id) ajouterBase(id) }}
                  className={`rounded-xl border-2 border-dashed p-4 min-h-[140px] transition-colors ${survole ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200'}`}
                >
                  {lignesAvecCout.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-8 text-gray-400">
                      <Package size={24} className="mb-2" />
                      <p className="text-sm">Glisse une base ou un appareil ici<br />(ou clique dessus à gauche)</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {lignesAvecCout.map((l) => {
                        const options = uniteesCompatibles(l.mp)
                        return (
                          <div key={l.baseId} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                            <Package size={14} className="text-gray-300 shrink-0" />
                            <span className="text-sm font-medium text-gray-700 flex-1 truncate">{l.base?.nom}</span>
                            <input
                              type="number" className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-right"
                              value={l.quantite}
                              onChange={(e) => updateLigne(l.baseId, { quantite: e.target.value })}
                            />
                            {options.length > 1 ? (
                              <select className="border border-gray-200 rounded px-1 py-1 text-xs" value={l.unite} onChange={(e) => updateLigne(l.baseId, { unite: e.target.value })}>
                                {options.map((u) => <option key={u} value={u}>{u}</option>)}
                              </select>
                            ) : (
                              <span className="text-xs text-gray-400 w-8">{l.unite}</span>
                            )}
                            <span className="text-xs text-gray-500 w-16 text-right">{l.coutLigne.toFixed(3)}€</span>
                            <button onClick={() => retirerBase(l.baseId)}><Trash2 size={13} className="text-gray-300 hover:text-red-500" /></button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Atelier</label>
                    <select className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" value={form.atelier_id} onChange={(e) => setForm({ ...form, atelier_id: e.target.value })}>
                      <option value="">—</option>
                      {ateliers.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Qté produit</label>
                    <input type="number" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" value={form.qte_produit} onChange={(e) => setForm({ ...form, qte_produit: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Volume prod.</label>
                    <input type="number" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" value={form.volume_prod} onChange={(e) => setForm({ ...form, volume_prod: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Tps prépa (min)</label>
                    <input type="number" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" value={form.tps_prepa_min} onChange={(e) => setForm({ ...form, tps_prepa_min: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Tps cuisson (min)</label>
                    <input type="number" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" value={form.tps_cuisson_min} onChange={(e) => setForm({ ...form, tps_cuisson_min: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Packaging U (€)</label>
                    <input type="number" step="0.001" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" value={form.packaging_u} onChange={(e) => setForm({ ...form, packaging_u: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-gray-500 mb-1 block">PV TTC (€)</label>
                    <input type="number" step="0.01" placeholder="—" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" value={form.pv_ttc} onChange={(e) => setForm({ ...form, pv_ttc: e.target.value })} />
                  </div>
                </div>

                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                  <span className="text-xs text-gray-500">Coût de revient estimé</span>
                  <span className="text-xl font-bold" style={{ color: '#C9A84C' }}>{calcApercu.coutRevientU.toFixed(3)} €</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'assemblage' && (
          <div className="flex justify-between px-8 py-4 border-t border-gray-100">
            <button onClick={() => setStep('categorie')} className="px-4 py-2 text-sm text-gray-500">← Changer de catégorie</button>
            <button
              onClick={creerRecette}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#C9A84C' }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />} Créer la recette
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
