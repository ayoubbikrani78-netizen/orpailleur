import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { calculerCoutRevient, resoudreCmup, tauxMarque, statutRecette } from '../lib/coutRevient'
import { CheckCircle2, AlertTriangle, Package } from 'lucide-react'

export default function CoutRevient() {
  const [recettes, setRecettes] = useState([])
  const [ateliers, setAteliers] = useState([])
  const [matieres, setMatieres] = useState([])
  const [bareme, setBareme] = useState([])
  const [elementsAll, setElementsAll] = useState([])
  const [ingredientsAll, setIngredientsAll] = useState([])
  const [reglages, setReglages] = useState({ perte_defaut: 0.08, tva_defaut: 0.055, seuil_marge: 0.6 })
  const [loading, setLoading] = useState(true)
  const [familleFilter, setFamilleFilter] = useState('Toutes')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: rec }, { data: ate }, { data: mp }, { data: bar }, { data: regl }, { data: els }, { data: ings }] =
      await Promise.all([
        supabase.from('recettes').select('*').order('famille').order('nom'),
        supabase.from('ateliers').select('*'),
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
    return { matieresById, recettesParMpId, elementsParRecetteId, ingredientsParElementId, ingredientsDirectsParRecetteId, tauxHoraireParAtelier, bareme, perteDefaut: reglages.perte_defaut }
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
    return { r, calc, marque, statut }
  }), [recettes, ctx, bareme, reglages])

  const familles = ['Toutes', ...new Set(recettes.map((r) => r.famille))]
  const filtrees = familleFilter === 'Toutes' ? lignes : lignes.filter((l) => l.r.famille === familleFilter)

  async function updatePvTtc(id, value) {
    await supabase.from('recettes').update({ pv_ttc: value === '' ? null : parseFloat(value) }).eq('id', id)
    fetchAll()
  }

  const nbOk = lignes.filter((l) => l.statut.code === 'ok').length
  const nbAlerte = lignes.filter((l) => l.statut.code === 'alerte').length
  const nbComposant = lignes.filter((l) => l.statut.code === 'composant').length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Coût de revient</h2>
        <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={familleFilter} onChange={(e) => setFamilleFilter(e.target.value)}>
          {familles.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Produits" value={recettes.length} />
        <StatCard label="OK" value={nbOk} color="text-green-600" />
        <StatCard label="En alerte" value={nbAlerte} color="text-orange-500" />
        <StatCard label="Composants" value={nbComposant} color="text-gray-500" />
      </div>

      {loading ? <p className="text-gray-400">Chargement...</p> : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Famille</th>
                <th className="px-4 py-3">Produit</th>
                <th className="px-4 py-3 text-right">Matière U</th>
                <th className="px-4 py-3 text-right">MO U</th>
                <th className="px-4 py-3 text-right">Énergie U</th>
                <th className="px-4 py-3 text-right">Packaging U</th>
                <th className="px-4 py-3 text-right">Coût revient U</th>
                <th className="px-4 py-3 text-right">PV TTC</th>
                <th className="px-4 py-3 text-right">Taux de marque</th>
                <th className="px-4 py-3">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filtrees.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Aucune recette. Ajoute-en depuis la page Recettes.</td></tr>
              )}
              {filtrees.map(({ r, calc, marque, statut }) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500">{r.famille}</td>
                  <td className="px-4 py-3 font-medium text-gray-700">{r.nom}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{calc.matiereU.toFixed(3)}€</td>
                  <td className="px-4 py-3 text-right text-gray-500">{calc.moU.toFixed(3)}€</td>
                  <td className="px-4 py-3 text-right text-gray-500">{calc.energieU.toFixed(3)}€</td>
                  <td className="px-4 py-3 text-right text-gray-500">{calc.packagingU.toFixed(3)}€</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
