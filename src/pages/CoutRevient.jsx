import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculerCoutRevient, resoudreCmup, tauxMarque, statutRecette } from '../lib/coutRevient'
import { CheckCircle2, AlertTriangle, Package, X, Search } from 'lucide-react'

export default function CoutRevient() {
  const [recettes, setRecettes] = useState([])
  const [ateliers, setAteliers] = useState([])
  const [matieres, setMatieres] = useState([])
  const [bareme, setBareme] = useState([])
  const [elementsAll, setElementsAll] = useState([])
  const [ingredientsAll, setIngredientsAll] = useState([])
  const [reglages, setReglages] = useState({ perte_defaut: 0.08, tva_defaut: 0.055, seuil_marge: 0.6 })
  const [loading, setLoading] = useState(true)
  const [atelierActif, setAtelierActif] = useState('Tous')
  const [query, setQuery] = useState('')
  const [detailId, setDetailId] = useState(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: rec }, { data: ate }, { data: mp }, { data: bar }, { data: regl }, { data: els }, { data: ings }] =
      await Promise.all([
        supabase.from('recettes').select('*').order('famille').order('nom'),
        supabase.from('ateliers').select('*').order('nom'),
        supabase.from('matieres_premieres').select('id, designation_interne, unite, cmp'),
        supabase.from('bareme_energie').select('*'),
        supabase.from('reglages').select('perte_defaut, tva_defaut, seuil_marge').limit(1).maybeSingle(),
        supabase.from('recette_elements').select('*'),
        supabase.from('recette_ingredients').select('*'),
      ])
    setRecettes(rec || [])
    setAteliers(ate || [])
    setMatieres(mp || [])
    setBareme(bar || [])
    if (regl) setReglages({
      perte_defaut: regl.perte_defaut ?? 0.08,
      tva_defaut: regl.tva_defaut ?? 0.055,
      seuil_marge: regl.seuil_marge ?? 0.6,
    })
    setElementsAll(els || [])
    setIngredientsAll(ings || [])
    setLoading(false)
  }

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
    const ateliersById = Object.fromEntries(ateliers.map((a) => [a.id, a]))
    return { matieresById, recettesParMpId, elementsParRecetteId, ingredientsParElementId, ingredientsDirectsParRecetteId, tauxHoraireParAtelier, ateliersById, bareme, perteDefaut: reglages.perte_defaut }
  }, [matieres, recettes, elementsAll, ingredientsAll, ateliers, bareme, reglages])

  const lignes = useMemo(() => recettes.map((r) => {
    const elements = (ctx.elementsParRecetteId[r.id] || []).map((el) => ({
      ...el,
      ingredients: (ctx.ingredientsParElementId[el.id] || []).map((ing) => {
        let cmup = 0
        try { cmup = resoudreCmup(ing.matiere_premiere_id, ctx) } catch { cmup = 0 }
        return { ...ing, cmup, mp: ctx.matieresById[ing.matiere_premiere_id] }
      }),
    }))
    const ingredientsDirects = (ctx.ingredientsDirectsParRecetteId[r.id] || []).map((ing) => {
      let cmup = 0
      try { cmup = resoudreCmup(ing.matiere_premiere_id, ctx) } catch { cmup = 0 }
      return { ...ing, cmup, mp: ctx.matieresById[ing.matiere_premiere_id] }
    })
    const calc = calculerCoutRevient(r, {
      tauxHoraire: ctx.tauxHoraireParAtelier[r.atelier_id] || 0,
      bareme, perteDefaut: reglages.perte_defaut, elements, ingredientsDirects,
    })
    const tva = r.tva_pct ?? reglages.tva_defaut
    const marque = tauxMarque(calc.coutRevientU, r.pv_ttc, tva)
    const statut = statutRecette(r, calc.coutRevientU, reglages.seuil_marge)
    const atelier = ctx.ateliersById[r.atelier_id]
    return { r, calc, marque, statut, atelier, tva }
  }), [recettes, ctx, bareme, reglages])

  const ateliersDisponibles = useMemo(() => {
    const compte = {}
    for (const l of lignes) {
      const nom = l.atelier?.nom || 'Sans atelier'
      compte[nom] = (compte[nom] || 0) + 1
    }
    return Object.entries(compte).sort((a, b) => a[0].localeCompare(b[0]))
  }, [lignes])

  const filtrees = lignes
    .filter((l) => l.r.nom.toLowerCase().includes(query.toLowerCase()))
    .filter((l) => atelierActif === 'Tous' || (l.atelier?.nom || 'Sans atelier') === atelierActif)

  async function updatePvTtc(id, value) {
    await supabase.from('recettes').update({ pv_ttc: value === '' ? null : parseFloat(value) }).eq('id', id)
    fetchAll()
  }

  const nbOk = lignes.filter((l) => l.statut.code === 'ok').length
  const nbAlerte = lignes.filter((l) => l.statut.code === 'alerte').length
  const nbComposant = lignes.filter((l) => l.statut.code === 'composant').length
  const ligneDetail = lignes.find((l) => l.r.id === detailId)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Coût de revient</h2>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Produits" value={recettes.length} />
        <StatCard label="OK" value={nbOk} color="text-green-600" />
        <StatCard label="En alerte" value={nbAlerte} color="text-orange-500" />
        <StatCard label="Composants" value={nbComposant} color="text-gray-500" />
      </div>

      <div className="flex gap-1 p-1 rounded-lg bg-gray-100 mb-4 overflow-x-auto">
        <TabButton active={atelierActif === 'Tous'} onClick={() => setAtelierActif('Tous')}>
          Tous <span className="text-xs text-gray-400 ml-1">{lignes.length}</span>
        </TabButton>
        {ateliersDisponibles.map(([nom, nb]) => (
          <TabButton key={nom} active={atelierActif === nom} onClick={() => setAtelierActif(nom)}>
            {nom} <span className="text-xs text-gray-400 ml-1">{nb}</span>
          </TabButton>
        ))}
      </div>

      <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2 mb-4 max-w-sm">
        <Search size={15} className="text-gray-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un produit..." className="flex-1 text-sm outline-none" />
      </div>

      {loading ? <p className="text-gray-400">Chargement...</p> : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Produit</th>
                <th className="px-4 py-3">Famille</th>
                <th className="px-4 py-3 text-right">Coût revient U</th>
                <th className="px-4 py-3 text-right">PV TTC</th>
                <th className="px-4 py-3 text-right">Taux de marque</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtrees.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucune recette{query ? ' pour cette recherche' : ''}. Ajoute-en depuis la page Recettes.</td></tr>
              )}
              {filtrees.map(({ r, calc, marque, statut }) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-700">{r.nom}</td>
                  <td className="px-4 py-3 text-gray-500">{r.famille}</td>
                  <td className="px-4 py-3 text-right font-semibold" style={{ color: '#C9A84C' }}>{calc.coutRevientU.toFixed(3)}€</td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number" step="0.01" placeholder="—"
                      className="w-20 text-right border border-transparent hover:border-gray-200 focus:border-gray-300 rounded px-1 py-0.5 text-sm outline-none"
                      defaultValue={r.pv_ttc ?? ''}
                      onBlur={(e) => e.target.value !== String(r.pv_ttc ?? '') && updatePvTtc(r.id, e.target.value)}
                    />
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${marque === null ? 'text-gray-300' : marque < reglages.seuil_marge ? 'text-orange-500' : 'text-green-600'}`}>
                    {marque === null ? '—' : `${(marque * 100).toFixed(0)}%`}
                  </td>
                  <td className="px-4 py-3"><StatusBadge statut={statut} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setDetailId(r.id)} className="text-xs font-medium text-gray-500 hover:text-gray-800 underline underline-offset-2">Plus d'infos</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ligneDetail && (
        <DetailModal ligne={ligneDetail} reglages={reglages} onClose={() => setDetailId(null)} onSave={updatePvTtc} />
      )}
    </div>
  )
}

function DetailModal({ ligne, reglages, onClose, onSave }) {
  const { r, calc, marque, statut, atelier, tva } = ligne
  const qteProduit = Number(r.qte_produit) || 1
  const volumeProd = Number(r.volume_prod) || qteProduit
  const coeff = qteProduit ? volumeProd / qteProduit : 1
  const pvHt = r.pv_ttc ? r.pv_ttc / (1 + tva) : null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="text-xs text-gray-400">{r.famille}{atelier ? ` · ${atelier.nom}` : ''}</p>
            <h3 className="text-xl font-bold text-gray-800">{r.nom}</h3>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge statut={statut} />
            <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
          </div>
        </div>

        <div className="flex items-end justify-between my-6">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Coût de revient unitaire</p>
            <p className="text-4xl font-bold" style={{ color: '#C9A84C' }}>{calc.coutRevientU.toFixed(3)} €</p>
          </div>
          {r.est_composant && (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500"><Package size={13} /> Composant maison</span>
          )}
        </div>

        <Section title="Production">
          <Field label="Qté produit" value={qteProduit} />
          <Field label="Volume prod." value={volumeProd} />
          <Field label="Coeff (volume/qté)" value={coeff.toFixed(2)} />
          <Field label="Tps prépa" value={r.tps_prepa_min != null ? `${r.tps_prepa_min} min` : 'À caler'} warn={r.tps_prepa_min == null} />
          <Field label="Taux MO atelier" value={atelier ? `${atelier.taux_horaire}€/h` : '—'} />
          <Field label="Tps cuisson" value={`${r.tps_cuisson_min || 0} min`} />
        </Section>

        <Section title="Décomposition du coût">
          <Field label="Matière recette (total)" value={`${calc.matiereRecette.toFixed(3)}€`} />
          <Field label="Matière U" value={`${calc.matiereU.toFixed(3)}€`} />
          <Field label="MO U" value={`${calc.moU.toFixed(3)}€`} />
          <Field label="Énergie U" value={`${calc.energieU.toFixed(3)}€`} />
          <Field label="Packaging U" value={`${calc.packagingU.toFixed(3)}€`} />
          <Field label="Coef perte" value={`${(calc.perte * 100).toFixed(0)}%`} />
        </Section>

        <Section title="Prix de vente & marge">
          <Field label="TVA" value={`${(tva * 100).toFixed(1)}%`} />
          <Field label="PV TTC" value={
            <input
              type="number" step="0.01" placeholder="—"
              className="w-24 text-right border border-gray-200 rounded px-2 py-1 text-sm"
              defaultValue={r.pv_ttc ?? ''}
              onBlur={(e) => e.target.value !== String(r.pv_ttc ?? '') && onSave(r.id, e.target.value)}
            />
          } noTruncate />
          <Field label="PV HT" value={pvHt ? `${pvHt.toFixed(3)}€` : '—'} />
          <Field label="Marge brute U" value={marque !== null ? `${(pvHt - calc.coutRevientU).toFixed(3)}€` : '—'} />
          <Field label="Taux de marque" value={marque !== null ? `${(marque * 100).toFixed(1)}%` : '—'} highlight={marque !== null && marque < reglages.seuil_marge ? 'orange' : marque !== null ? 'green' : null} />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{title}</h4>
      <div className="grid grid-cols-3 gap-3">{children}</div>
    </div>
  )
}

function Field({ label, value, warn, highlight, noTruncate }) {
  const color = highlight === 'orange' ? '#B4762C' : highlight === 'green' ? '#3F7A45' : warn ? '#B4762C' : '#1F2937'
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className={`text-sm font-semibold ${noTruncate ? '' : 'truncate'}`} style={{ color }}>{value}</p>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors"
      style={{
        backgroundColor: active ? '#FFFFFF' : 'transparent',
        color: active ? '#1F2937' : '#6B7280',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      {children}
    </button>
  )
}

function StatCard({ label, value, color = 'text-gray-800' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function StatusBadge({ statut }) {
  if (statut.code === 'ok')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-600"><CheckCircle2 size={12} /> OK</span>
  if (statut.code === 'composant')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500"><Package size={12} /> Composant</span>
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-500"><AlertTriangle size={12} /> {statut.label}</span>
}
