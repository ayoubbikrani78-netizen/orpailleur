import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculerCoutRevient, resoudreCmup, uniteesCompatibles, quantiteEnBase } from '../lib/coutRevient'
import { reconcilierIngredientsEnAttente } from '../lib/importRecette'
import ImporterRecetteModal from '../components/ImporterRecetteModal'
import RapprochementMasseModal from '../components/RapprochementMasseModal'
import AssemblageBuilderModal from '../components/AssemblageBuilderModal'
import { Plus, ChevronRight, Trash2, Search, AlertTriangle, Layers, Upload, RefreshCw } from 'lucide-react'

const EMPTY_INGREDIENT = { matiere_premiere_id: '', quantite: '', unite: 'g' }

export default function VosRecettes() {
  const [recettes, setRecettes] = useState([])
  const [ateliers, setAteliers] = useState([])
  const [matieres, setMatieres] = useState([])
  const [bareme, setBareme] = useState([])
  const [perteDefaut, setPerteDefaut] = useState(0.08)
  const [elementsAll, setElementsAll] = useState([])
  const [ingredientsAll, setIngredientsAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRapprochementMasse, setShowRapprochementMasse] = useState(false)
  const [rapprochementEnCours, setRapprochementEnCours] = useState(false)
  const [rapprochementMessage, setRapprochementMessage] = useState('')
  const [query, setQuery] = useState('')
  const [familleActive, setFamilleActive] = useState('Toutes')
  const [newElementNom, setNewElementNom] = useState('')
  const [showElements, setShowElements] = useState(false)
  const [newIngredientByElement, setNewIngredientByElement] = useState({})
  const [newIngredientDirect, setNewIngredientDirect] = useState(EMPTY_INGREDIENT)

  useEffect(() => { fetchAll() }, [])
  useEffect(() => { setShowElements(false) }, [selectedId])

  async function fetchAll() {
    setLoading(true)
    const [{ data: rec }, { data: ate }, { data: mp }, { data: bar }, { data: regl }, { data: els }, { data: ings }] =
      await Promise.all([
        supabase.from('recettes').select('*').order('famille').order('nom'),
        supabase.from('ateliers').select('*').order('nom'),
        supabase.from('matieres_premieres').select('id, designation_interne, unite, cmp, poids_moyen_g').order('designation_interne'),
        supabase.from('bareme_energie').select('*'),
        supabase.from('reglages').select('perte_defaut').limit(1).maybeSingle(),
        supabase.from('recette_elements').select('*').order('ordre'),
        supabase.from('recette_ingredients').select('*'),
      ])
    setRecettes(rec || [])
    setAteliers(ate || [])
    setMatieres(mp || [])
    setBareme(bar || [])
    setPerteDefaut(regl?.perte_defaut ?? 0.08)
    setElementsAll(els || [])
    setIngredientsAll(ings || [])
    setLoading(false)
  }

  // ---- Contexte de calcul partagé (résolution CMUP, y compris composants récursifs) ----
  const ctx = useMemo(() => {
    const matieresById = Object.fromEntries(matieres.map((m) => [m.id, m]))
    const recettesParMpId = Object.fromEntries(
      recettes.filter((r) => r.est_composant && r.matiere_premiere_id).map((r) => [r.matiere_premiere_id, r])
    )
    const elementsParRecetteId = {}
    for (const el of elementsAll) {
      (elementsParRecetteId[el.recette_id] ||= []).push(el)
    }
    const ingredientsParElementId = {}
    const ingredientsDirectsParRecetteId = {}
    for (const ing of ingredientsAll) {
      if (ing.element_id) (ingredientsParElementId[ing.element_id] ||= []).push(ing)
      else if (ing.recette_id) (ingredientsDirectsParRecetteId[ing.recette_id] ||= []).push(ing)
    }
    const tauxHoraireParAtelier = Object.fromEntries(ateliers.map((a) => [a.id, a.taux_horaire]))
    return { matieresById, recettesParMpId, elementsParRecetteId, ingredientsParElementId, ingredientsDirectsParRecetteId, tauxHoraireParAtelier, bareme, perteDefaut }
  }, [matieres, recettes, elementsAll, ingredientsAll, ateliers, bareme, perteDefaut])

  function resoudreIngredient(ing) {
    let cmup = 0, erreur = null
    try { cmup = resoudreCmup(ing.matiere_premiere_id, ctx) } catch (e) { erreur = e.message }
    return { ...ing, cmup, erreur, mp: ctx.matieresById[ing.matiere_premiere_id] }
  }

  function elementsAvecCmup(recetteId) {
    return (ctx.elementsParRecetteId[recetteId] || []).map((el) => ({
      ...el,
      ingredients: (ctx.ingredientsParElementId[el.id] || []).map(resoudreIngredient),
    }))
  }

  function ingredientsDirectsAvecCmup(recetteId) {
    return (ctx.ingredientsDirectsParRecetteId[recetteId] || []).map(resoudreIngredient)
  }

  const selected = recettes.find((r) => r.id === selectedId) || null
  const selectedElements = selected ? elementsAvecCmup(selected.id) : []
  const selectedIngredientsDirects = selected ? ingredientsDirectsAvecCmup(selected.id) : []
  const selectedCalc = selected
    ? calculerCoutRevient(selected, {
        tauxHoraire: ctx.tauxHoraireParAtelier[selected.atelier_id] || 0,
        bareme, perteDefaut, elements: selectedElements, ingredientsDirects: selectedIngredientsDirects,
      })
    : null

  const recettesFinales = useMemo(() => recettes.filter((r) => !r.est_composant), [recettes])

  const familles = useMemo(() => {
    const compte = {}
    for (const r of recettesFinales) compte[r.famille] = (compte[r.famille] || 0) + 1
    return Object.entries(compte).sort((a, b) => a[0].localeCompare(b[0]))
  }, [recettesFinales])

  const filtered = recettesFinales
    .filter((r) => r.nom.toLowerCase().includes(query.toLowerCase()))
    .filter((r) => familleActive === 'Toutes' || r.famille === familleActive)

  // ---- Actions ----
  async function updateSelected(patch) {
    await supabase.from('recettes').update(patch).eq('id', selected.id)
    fetchAll()
  }

  async function deleteRecette() {
    if (!window.confirm(`Supprimer définitivement la recette "${selected.nom}" ?`)) return
    await supabase.from('recettes').delete().eq('id', selected.id)
    setSelectedId(null)
    fetchAll()
  }

  async function addElement() {
    if (!newElementNom.trim()) return
    const ordre = (ctx.elementsParRecetteId[selected.id] || []).length
    await supabase.from('recette_elements').insert({ recette_id: selected.id, nom: newElementNom.trim(), ordre })
    setNewElementNom('')
    fetchAll()
  }

  async function deleteElement(elementId) {
    await supabase.from('recette_elements').delete().eq('id', elementId)
    fetchAll()
  }

  async function addIngredient(elementId) {
    const draft = newIngredientByElement[elementId] || EMPTY_INGREDIENT
    if (!draft.matiere_premiere_id || !draft.quantite) return
    const mp = ctx.matieresById[draft.matiere_premiere_id]
    await supabase.from('recette_ingredients').insert({
      element_id: elementId,
      matiere_premiere_id: draft.matiere_premiere_id,
      quantite: parseFloat(draft.quantite),
      unite: draft.unite || mp?.unite || 'g',
    })
    setNewIngredientByElement({ ...newIngredientByElement, [elementId]: EMPTY_INGREDIENT })
    fetchAll()
  }

  async function addIngredientDirect() {
    const draft = newIngredientDirect
    if (!draft.matiere_premiere_id || !draft.quantite) return
    const mp = ctx.matieresById[draft.matiere_premiere_id]
    await supabase.from('recette_ingredients').insert({
      recette_id: selected.id,
      matiere_premiere_id: draft.matiere_premiere_id,
      quantite: parseFloat(draft.quantite),
      unite: draft.unite || mp?.unite || 'g',
    })
    setNewIngredientDirect(EMPTY_INGREDIENT)
    fetchAll()
  }

  async function deleteIngredient(id) {
    await supabase.from('recette_ingredients').delete().eq('id', id)
    fetchAll()
  }

  async function resoudreIngredientEnAttente(ingredientId, matierePremiereId) {
    await supabase.from('recette_ingredients').update({ matiere_premiere_id: matierePremiereId, designation_brute: null }).eq('id', ingredientId)
    fetchAll()
  }

  const idsFinales = useMemo(() => new Set(recettesFinales.map((r) => r.id)), [recettesFinales])
  const idsElementsFinales = useMemo(() => new Set(elementsAll.filter((e) => idsFinales.has(e.recette_id)).map((e) => e.id)), [elementsAll, idsFinales])
  const nbEnAttente = ingredientsAll.filter((i) =>
    !i.matiere_premiere_id && i.designation_brute &&
    (idsFinales.has(i.recette_id) || idsElementsFinales.has(i.element_id))
  ).length

  async function lancerRapprochement() {
    setRapprochementEnCours(true)
    setRapprochementMessage('')
    try {
      const { rapproches, total } = await reconcilierIngredientsEnAttente()
      setRapprochementMessage(rapproches > 0 ? `${rapproches} ingrédient(s) rapprochés automatiquement (sans ambiguïté).` : '')
      await fetchAll()
      if (total - rapproches > 0) setShowRapprochementMasse(true)
    } finally {
      setRapprochementEnCours(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Vos recettes</h2>
        <div className="flex items-center gap-2">
          {nbEnAttente > 0 && (
            <button onClick={lancerRapprochement} disabled={rapprochementEnCours} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-orange-600 border border-orange-200 bg-orange-50 disabled:opacity-50">
              <RefreshCw size={16} className={rapprochementEnCours ? 'animate-spin' : ''} /> {rapprochementEnCours ? 'Rapprochement...' : `${nbEnAttente} ingrédient(s) en attente`}
            </button>
          )}
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200">
            <Upload size={16} /> Importer un fichier
          </button>
          <button onClick={() => setShowBuilder(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
            <Plus size={16} /> Nouvelle recette
          </button>
        </div>
      </div>
      {rapprochementMessage && <p className="text-xs text-gray-500 mb-4">{rapprochementMessage}</p>}

      <div className="flex gap-1 p-1 rounded-lg bg-gray-100 mb-4 overflow-x-auto">
        <button
          onClick={() => setFamilleActive('Toutes')}
          className="px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors"
          style={{
            backgroundColor: familleActive === 'Toutes' ? '#FFFFFF' : 'transparent',
            color: familleActive === 'Toutes' ? '#1F2937' : '#6B7280',
            boxShadow: familleActive === 'Toutes' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          Toutes <span className="text-xs text-gray-400 ml-1">{recettesFinales.length}</span>
        </button>
        {familles.map(([famille, nb]) => (
          <button
            key={famille}
            onClick={() => setFamilleActive(famille)}
            className="px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors"
            style={{
              backgroundColor: familleActive === famille ? '#FFFFFF' : 'transparent',
              color: familleActive === famille ? '#1F2937' : '#6B7280',
              boxShadow: familleActive === famille ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {famille} <span className="text-xs text-gray-400 ml-1">{nb}</span>
          </button>
        ))}
      </div>

      {loading ? <p className="text-gray-400">Chargement...</p> : (
        <div className="grid grid-cols-12 gap-6">
          {/* Liste */}
          <div className="col-span-4">
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2 mb-3">
              <Search size={15} className="text-gray-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher..." className="flex-1 text-sm outline-none" />
            </div>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
              {filtered.length === 0 && <p className="p-6 text-gray-400 text-sm">Aucune recette pour cette famille.</p>}
              {filtered.map((r) => (
                <button key={r.id} onClick={() => setSelectedId(r.id)} className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50 ${selectedId === r.id ? 'bg-yellow-50' : ''}`}>
                  <span className="text-sm font-medium text-gray-700">{r.nom}{r.est_composant && <span className="ml-2 text-[10px] text-gray-400">(composant)</span>}</span>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              ))}
            </div>
          </div>

          {/* Détail */}
          <div className="col-span-8">
            {!selected ? (
              <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">
                Sélectionne une recette à gauche, ou crée-en une nouvelle.
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-xs text-gray-400">{selected.famille}</p>
                    <h3 className="text-xl font-bold text-gray-800">{selected.nom}</h3>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Coût de revient</p>
                      <p className="text-2xl font-bold" style={{ color: '#C9A84C' }}>{selectedCalc.coutRevientU.toFixed(3)} €</p>
                    </div>
                    <button onClick={deleteRecette} className="text-red-400 hover:text-red-600"><Trash2 size={18} /></button>
                  </div>
                </div>

                {/* Paramètres */}
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <Field label="Atelier">
                    <select className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" value={selected.atelier_id || ''} onChange={(e) => updateSelected({ atelier_id: e.target.value || null })}>
                      <option value="">—</option>
                      {ateliers.map((a) => <option key={a.id} value={a.id}>{a.nom} ({a.taux_horaire}€/h)</option>)}
                    </select>
                  </Field>
                  <Field label="Qté produit"><NumInput value={selected.qte_produit} onCommit={(v) => updateSelected({ qte_produit: v })} /></Field>
                  <Field label="Volume prod."><NumInput value={selected.volume_prod} onCommit={(v) => updateSelected({ volume_prod: v })} /></Field>
                  <Field label="Tps prépa (min)"><NumInput value={selected.tps_prepa_min ?? ''} placeholder="à caler" onCommit={(v) => updateSelected({ tps_prepa_min: v === '' ? null : v })} /></Field>
                  <Field label="Tps cuisson (min)"><NumInput value={selected.tps_cuisson_min} onCommit={(v) => updateSelected({ tps_cuisson_min: v })} /></Field>
                  <Field label="Packaging U (€)"><NumInput value={selected.packaging_u} step="0.001" onCommit={(v) => updateSelected({ packaging_u: v })} /></Field>
                  <Field label="PV TTC (€)"><NumInput value={selected.pv_ttc ?? ''} placeholder="—" onCommit={(v) => updateSelected({ pv_ttc: v === '' ? null : v })} /></Field>
                </div>

                {!selected.tps_prepa_min && (
                  <div className="flex items-center gap-2 text-xs text-orange-500 bg-orange-50 rounded-lg px-3 py-2 mb-4">
                    <AlertTriangle size={14} /> Temps de préparation à caler — la main d'œuvre n'est pas comptée (MO = 0).
                  </div>
                )}

                {/* Répartition */}
                <div className="flex gap-4 text-xs text-gray-500 mb-6">
                  <span>Matière <b className="text-gray-700">{selectedCalc.matiereU.toFixed(3)}€</b></span>
                  <span>MO <b className="text-gray-700">{selectedCalc.moU.toFixed(3)}€</b></span>
                  <span>Énergie <b className="text-gray-700">{selectedCalc.energieU.toFixed(3)}€</b></span>
                  <span>Packaging <b className="text-gray-700">{selectedCalc.packagingU.toFixed(3)}€</b></span>
                  <span>Perte <b className="text-gray-700">{(selectedCalc.perte * 100).toFixed(0)}%</b></span>
                </div>

                {/* Ingrédients directs — le cas simple, sans élément */}
                <div className="border border-gray-200 rounded-lg mb-4">
                  <div className="px-4 py-2 bg-gray-50 rounded-t-lg">
                    <span className="text-sm font-semibold text-gray-700">Ingrédients</span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {selectedIngredientsDirects.map((ing) => (
                        <IngredientRow key={ing.id} ing={ing} matieres={matieres} onDelete={() => deleteIngredient(ing.id)} onResoudre={resoudreIngredientEnAttente} />
                      ))}
                      {selectedIngredientsDirects.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-3 text-gray-400 text-xs">Aucun ingrédient direct pour l'instant.</td></tr>
                      )}
                    </tbody>
                  </table>
                  <IngredientPicker
                    matieres={matieres} ctx={ctx} draft={newIngredientDirect}
                    setDraft={setNewIngredientDirect} onAdd={addIngredientDirect}
                  />
                </div>

                {/* Éléments (sous-recettes) — optionnel, pour les recettes à plusieurs couches */}
                {selectedElements.length > 0 && (
                  <div className="space-y-4 mb-4">
                    {selectedElements.map((el) => {
                      const elTotal = el.ingredients.reduce((s, i) => s + quantiteEnBase(i.quantite, i.unite, i.mp) * i.cmup, 0)
                      return (
                        <div key={el.id} className="border border-gray-200 rounded-lg">
                          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded-t-lg">
                            <span className="text-sm font-semibold text-gray-700">{el.nom}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-400">{elTotal.toFixed(3)} €</span>
                              <button onClick={() => deleteElement(el.id)}><Trash2 size={13} className="text-gray-300 hover:text-red-500" /></button>
                            </div>
                          </div>
                          <table className="w-full text-sm">
                            <tbody>
                              {el.ingredients.map((ing) => (
                                <IngredientRow key={ing.id} ing={ing} matieres={matieres} onDelete={() => deleteIngredient(ing.id)} onResoudre={resoudreIngredientEnAttente} />
                              ))}
                            </tbody>
                          </table>
                          <IngredientPicker
                            matieres={matieres} ctx={ctx}
                            draft={newIngredientByElement[el.id] || EMPTY_INGREDIENT}
                            setDraft={(d) => setNewIngredientByElement({ ...newIngredientByElement, [el.id]: d })}
                            onAdd={() => addIngredient(el.id)}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Lien discret pour les recettes à plusieurs couches (entremets, etc.) */}
                {!showElements && selectedElements.length === 0 ? (
                  <button onClick={() => setShowElements(true)} className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-600">
                    <Layers size={13} /> Cette recette a plusieurs préparations (biscuit, crème...) ? Ajouter un élément
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <input placeholder="Nom du nouvel élément (ex : Biscuit, Ganache...)" className="flex-1 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm" value={newElementNom} onChange={(e) => setNewElementNom(e.target.value)} />
                    <button onClick={addElement} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 border border-dashed border-gray-300">
                      <Plus size={14} /> Ajouter
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Créateur de recette par assemblage */}
      {showBuilder && (
        <AssemblageBuilderModal
          ateliers={ateliers}
          onClose={() => setShowBuilder(false)}
          onCreated={async (nouvelId) => {
            setShowBuilder(false)
            await fetchAll()
            setSelectedId(nouvelId)
          }}
        />
      )}

      {showImport && (
        <ImporterRecetteModal
          matieres={matieres}
          ateliers={ateliers}
          onClose={() => setShowImport(false)}
          onImported={async (nouvelId) => {
            setShowImport(false)
            await fetchAll()
            setSelectedId(nouvelId)
          }}
        />
      )}

      {showRapprochementMasse && (
        <RapprochementMasseModal
          onClose={() => setShowRapprochementMasse(false)}
          onDone={fetchAll}
        />
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>
      {children}
    </div>
  )
}

function IngredientRow({ ing, matieres, onDelete, onResoudre }) {
  if (!ing.matiere_premiere_id && ing.designation_brute) {
    return (
      <tr className="border-t border-gray-100 first:border-t-0 bg-orange-50/40">
        <td className="px-4 py-2 text-gray-500 italic">{ing.designation_brute}</td>
        <td className="px-2 py-2 text-right text-gray-400 w-24">{ing.quantite} {ing.unite}</td>
        <td className="px-2 py-2 text-right w-48" colSpan={2}>
          <select
            className="w-full border border-orange-300 bg-orange-50 rounded-lg px-2 py-1 text-xs text-gray-700"
            value=""
            onChange={(e) => e.target.value && onResoudre(ing.id, e.target.value)}
          >
            <option value="">— associer à un article —</option>
            {matieres.map((m) => <option key={m.id} value={m.id}>{m.designation_interne}</option>)}
          </select>
        </td>
        <td className="pr-3 w-8"><button onClick={onDelete}><Trash2 size={13} className="text-gray-300 hover:text-red-500" /></button></td>
      </tr>
    )
  }
  const qteBase = quantiteEnBase(ing.quantite, ing.unite, ing.mp)
  const uniteBaseLabel = ing.mp?.unite ? (ing.mp.unite.toLowerCase() === 'kg' ? 'g' : ing.mp.unite.toLowerCase() === 'l' ? 'ml' : ing.mp.unite) : ''
  return (
    <tr className="border-t border-gray-100 first:border-t-0">
      <td className="px-4 py-2 text-gray-700">
        {ing.mp?.designation_interne || '—'}
        {ing.erreur && <span className="ml-2 text-red-500 text-xs">⚠ {ing.erreur}</span>}
      </td>
      <td className="px-2 py-2 text-right text-gray-500 w-24">{ing.quantite} {ing.unite}</td>
      <td className="px-2 py-2 text-right text-gray-500 w-28">× {ing.cmup.toFixed(5)}€/{uniteBaseLabel}</td>
      <td className="px-4 py-2 text-right font-medium text-gray-700 w-20">{(qteBase * ing.cmup).toFixed(3)}€</td>
      <td className="pr-3 w-8"><button onClick={onDelete}><Trash2 size={13} className="text-gray-300 hover:text-red-500" /></button></td>
    </tr>
  )
}

// Ligne de saisie réutilisée pour les ingrédients directs ET ceux d'un élément
function IngredientPicker({ matieres, ctx, draft, setDraft, onAdd }) {
  const mpSelectionnee = draft.matiere_premiere_id ? ctx.matieresById[draft.matiere_premiere_id] : null
  const options = mpSelectionnee ? uniteesCompatibles(mpSelectionnee) : []
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-100">
      <select
        className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
        value={draft.matiere_premiere_id}
        onChange={(e) => {
          const mp = ctx.matieresById[e.target.value]
          setDraft({ ...draft, matiere_premiere_id: e.target.value, unite: uniteesCompatibles(mp)[0] })
        }}
      >
        <option value="">Ajouter un ingrédient (Mercuriale)...</option>
        {matieres.map((m) => <option key={m.id} value={m.id}>{m.designation_interne}</option>)}
      </select>
      <input type="number" placeholder="Qté" className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-xs" value={draft.quantite} onChange={(e) => setDraft({ ...draft, quantite: e.target.value })} />
      {options.length > 1 ? (
        <select className="w-16 border border-gray-200 rounded-lg px-1 py-1.5 text-xs" value={draft.unite} onChange={(e) => setDraft({ ...draft, unite: e.target.value })}>
          {options.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      ) : (
        <span className="text-xs text-gray-400 w-8">{draft.unite}</span>
      )}
      <button onClick={onAdd} className="p-1.5 rounded-lg text-white" style={{ backgroundColor: '#C9A84C' }}><Plus size={13} /></button>
    </div>
  )
}

// Champ numérique qui ne commit (update DB) qu'au blur, pour éviter une requête par frappe
function NumInput({ value, onCommit, step = '1', placeholder }) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <input
      type="number" step={step} placeholder={placeholder}
      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local === '' ? '' : parseFloat(local)) }}
    />
  )
}
