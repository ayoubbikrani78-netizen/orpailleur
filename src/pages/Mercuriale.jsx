import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rattraperCmupHistorique } from '../lib/cmup'
import { reconcilierIngredientsEnAttente } from '../lib/importRecette'
import { assignerCodeSiManquant } from '../lib/regroupement'
import CategoryPicker from '../components/CategoryPicker'
import SuggestionCategoriesModal from '../components/SuggestionCategoriesModal'
import { Plus, ChevronRight, X, TrendingUp, TrendingDown, RefreshCw, Search, Sparkles, Download, Trash2 } from 'lucide-react'

const EMPTY_MP = {
  univers: '', famille: '', designation_interne: '', unite: '', stock_mini: '',
  seuil_rouge: 3, seuil_orange: 7
}

const EMPTY_FOURNISSEUR_LINK = {
  fournisseur_id: '', reference_fournisseur: '', designation_fournisseur: '',
  conditionnement: '', prix_actuel: ''
}

export default function Mercuriale() {
  const [matieres, setMatieres] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY_MP)
  const [liens, setLiens] = useState([])
  const [mouvements, setMouvements] = useState([])
  const [correctionStock, setCorrectionStock] = useState({ quantite: '', raison: '' })
  const [rattrapageEnCours, setRattrapageEnCours] = useState(false)
  const [showSuggestionCategories, setShowSuggestionCategories] = useState(false)
  const [rattrapageMessage, setRattrapageMessage] = useState('')
  const [query, setQuery] = useState('')
  const [universActif, setUniversActif] = useState('Tous')
  const [familleActive, setFamilleActive] = useState('Toutes')

  async function lancerRattrapageCmup() {
    setRattrapageEnCours(true)
    setRattrapageMessage('')
    try {
      const { corriges, matieres: nb } = await rattraperCmupHistorique()
      setRattrapageMessage(corriges > 0
        ? `${corriges} mouvement(s) complété(s), CMUP recalculé pour ${nb} matière(s) première(s).`
        : 'Rien à rattraper — tous les mouvements ont déjà un prix enregistré.')
      fetchAll()
    } finally {
      setRattrapageEnCours(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const { data: mp } = await supabase.from('matieres_premieres').select('*').order('designation_interne')
    const { data: f } = await supabase.from('fournisseurs').select('*').eq('etat', 'actif').order('nom')
    const { data: cat } = await supabase.from('categories_mercuriale').select('*').order('univers').order('famille')
    setMatieres(mp || [])
    setFournisseurs(f || [])
    setCategories(cat || [])
    setLoading(false)
  }

  /** Ajoute un nouveau couple Univers/Famille au référentiel s'il n'existe pas encore. */
  async function assurerCategorie(univers, famille) {
    if (!univers || !famille) return
    const existe = categories.some((c) => c.univers === univers && c.famille === famille)
    if (existe) return
    await supabase.from('categories_mercuriale').insert({ univers, famille })
    const { data: cat } = await supabase.from('categories_mercuriale').select('*').order('univers').order('famille')
    setCategories(cat || [])
  }

  function getCouvertureColor(jours, seuilRouge, seuilOrange) {
    if (jours < seuilRouge) return { color: 'bg-red-50 text-red-500', dot: 'bg-red-400' }
    if (jours < seuilOrange) return { color: 'bg-orange-50 text-orange-500', dot: 'bg-orange-400' }
    return { color: 'bg-green-50 text-green-600', dot: 'bg-green-400' }
  }

  async function openDetail(mp) {
    setSelected(mp)
    const { data: l } = await supabase
      .from('matieres_premieres_fournisseurs')
      .select('*, fournisseurs(nom)')
      .eq('matiere_premiere_id', mp.id)
    setLiens(l || [])
    const { data: m } = await supabase
      .from('mouvements_stock')
      .select('*')
      .eq('matiere_premiere_id', mp.id)
      .order('date_mouvement', { ascending: false })
      .limit(20)
    setMouvements(m || [])
    setCorrectionStock({ quantite: mp.quantite_stock || 0, raison: '' })
    setShowDetail(true)
  }

  function openNew() {
    setForm(EMPTY_MP)
    setShowForm(true)
  }

  async function saveMatierePremiere() {
    if (!form.designation_interne) return alert('La désignation interne est obligatoire')
    await assurerCategorie(form.univers, form.famille)
    await supabase.from('matieres_premieres').insert({
      designation_interne: form.designation_interne,
      unite: form.unite,
      univers: form.univers || null,
      famille: form.famille || null,
      stock_mini: form.stock_mini || 0,
      seuil_rouge: form.seuil_rouge,
      seuil_orange: form.seuil_orange
    })
    setShowForm(false)
    fetchAll()
    reconcilierIngredientsEnAttente().catch((e) => console.error('Rapprochement recettes en attente échoué :', e))
  }

  async function updateCategorie(univers, famille) {
    await assurerCategorie(univers, famille)
    await supabase.from('matieres_premieres').update({ univers: univers || null, famille: famille || null }).eq('id', selected.id)
    if (univers) await assignerCodeSiManquant(selected.id, univers)
    setSelected({ ...selected, univers, famille })
    fetchAll()
  }

async function deleteMatierePremiere() {
  if (!window.confirm('Supprimer définitivement cette matière première ?')) return
  const { data: liens } = await supabase
    .from('matieres_premieres_fournisseurs')
    .select('id')
    .eq('matiere_premiere_id', selected.id)
  const liensIds = (liens || []).map(l => l.id)
  if (liensIds.length > 0) {
    await supabase.from('commandes_lignes').delete().in('matiere_premiere_fournisseur_id', liensIds)
  }
  await supabase.from('matieres_premieres_fournisseurs').delete().eq('matiere_premiere_id', selected.id)
  await supabase.from('mouvements_stock').delete().eq('matiere_premiere_id', selected.id)
  await supabase.from('matieres_premieres').delete().eq('id', selected.id)
  setShowDetail(false)
  fetchAll()
}

  function calculerPrixUnitaireBase(prix, conditionnement, unite) {
    if (!prix || !conditionnement) return 0
    const p = parseFloat(prix)
    const c = parseFloat(conditionnement)
    const u = (unite || '').toLowerCase()
    if (u === 'kg') return p / (c * 1000)
    if (u === 'l') return p / (c * 1000)
    if (u === 'g' || u === 'ml') return p / c
    return p / c
  }

  async function addFournisseurLink(mpId, link) {
    if (!link.fournisseur_id || !link.designation_fournisseur) return alert('Fournisseur et désignation requis')
    const prixBase = calculerPrixUnitaireBase(link.prix_actuel, link.conditionnement, selected?.unite)
    await supabase.from('matieres_premieres_fournisseurs').insert({
      matiere_premiere_id: mpId,
      fournisseur_id: link.fournisseur_id,
      reference_fournisseur: link.reference_fournisseur,
      designation_fournisseur: link.designation_fournisseur,
      conditionnement: link.conditionnement,
      unite: link.unite,
      prix_actuel: link.prix_actuel,
      prix_initial: link.prix_actuel,
      prix_g_u_ml: prixBase
    })
    openDetail(selected)
  }

  async function saveCorrectionStock() {
    if (!correctionStock.raison) return alert('La raison de la correction est obligatoire')
    const ajustement = parseFloat(correctionStock.quantite) || 0
    const ancienneQte = selected.quantite_stock || 0
    const nouvelleQte = ancienneQte + ajustement

    await supabase.from('mouvements_stock').insert({
      matiere_premiere_id: selected.id,
      type: 'correction',
      quantite: ajustement,
      raison: correctionStock.raison
    })
    await supabase.from('matieres_premieres').update({ quantite_stock: nouvelleQte }).eq('id', selected.id)
    openDetail({ ...selected, quantite_stock: nouvelleQte })
    fetchAll()
  }

  const nbNonCategorises = matieres.filter((mp) => !mp.univers).length
  const [selection, setSelection] = useState(new Set())

  function toggleSelection(id) {
    const next = new Set(selection)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelection(next)
  }

  async function supprimerSelection() {
    if (selection.size === 0) return
    if (!window.confirm(`Supprimer définitivement ${selection.size} article(s) de la Mercuriale ? Les recettes qui les utilisent repasseront "en attente".`)) return
    const ids = [...selection]

    // Restaure la désignation sur les lignes de recette avant de couper le lien, pour ne rien perdre
    const { data: lignesLiees } = await supabase.from('recette_ingredients').select('id, matiere_premiere_id').in('matiere_premiere_id', ids)
    for (const ligne of lignesLiees || []) {
      const mp = matieres.find((m) => m.id === ligne.matiere_premiere_id)
      await supabase.from('recette_ingredients').update({ matiere_premiere_id: null, designation_brute: mp?.designation_interne || 'Article supprimé' }).eq('id', ligne.id)
    }
    await supabase.from('recettes').update({ matiere_premiere_id: null }).in('matiere_premiere_id', ids)
    await supabase.from('mouvements_stock').delete().in('matiere_premiere_id', ids)
    await supabase.from('matieres_premieres_fournisseurs').delete().in('matiere_premiere_id', ids)
    await supabase.from('alertes').delete().in('reference_id', ids).eq('reference_table', 'matieres_premieres')
    await supabase.from('matieres_premieres').delete().in('id', ids)

    setSelection(new Set())
    fetchAll()
  }

  function exporterCsv(liste) {
    const entetes = ['Référence interne', 'Désignation', 'Catégorie', 'Sous-catégorie', 'Unité', 'CMUP (€)', 'Stock actuel', 'Couverture (jours)', 'Stock mini']
    const echapper = (v) => {
      const s = v == null ? '' : String(v)
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lignes = liste.map((mp) => [
      mp.code || '', mp.designation_interne, mp.univers || '', mp.famille || '', mp.unite || '',
      mp.cmp != null ? mp.cmp.toFixed(5) : '', mp.quantite_stock ?? '', mp.couverture_stock ?? '', mp.stock_mini ?? ''
    ])
    const csv = [entetes, ...lignes].map((l) => l.map(echapper).join(';')).join('\r\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mercuriale_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Mercuriale</h2>
        <div className="flex items-center gap-2">
          {nbNonCategorises > 0 && (
            <button onClick={() => setShowSuggestionCategories(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-orange-600 border border-orange-200 bg-orange-50">
              <Sparkles size={16} /> Suggérer les catégories ({nbNonCategorises})
            </button>
          )}
          <button onClick={lancerRattrapageCmup} disabled={rattrapageEnCours} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 disabled:opacity-50">
            <RefreshCw size={16} className={rattrapageEnCours ? 'animate-spin' : ''} /> {rattrapageEnCours ? 'Recalcul...' : 'Recalculer les CMUP'}
          </button>
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
            <Plus size={16} /> Ajouter une matière première
          </button>
        </div>
      </div>
      {rattrapageMessage && <p className="text-xs text-gray-500 mb-4">{rattrapageMessage}</p>}

      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2 max-w-sm flex-1">
          <Search size={15} className="text-gray-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un article..." className="flex-1 text-sm outline-none" />
        </div>
        <button onClick={() => exporterCsv(matieres)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 shrink-0">
          <Download size={16} /> Exporter en CSV
        </button>
      </div>

      {loading ? <p className="text-gray-400">Chargement...</p> : (() => {
        const universDisponibles = [...new Set(matieres.map((mp) => mp.univers || 'Non catégorisé'))].sort()
        const famillesDisponibles = universActif === 'Tous'
          ? []
          : [...new Set(matieres.filter((mp) => (mp.univers || 'Non catégorisé') === universActif).map((mp) => mp.famille || '—'))].sort()

        const filtrees = matieres
          .filter((mp) => mp.designation_interne.toLowerCase().includes(query.toLowerCase()))
          .filter((mp) => universActif === 'Tous' || (mp.univers || 'Non catégorisé') === universActif)
          .filter((mp) => familleActive === 'Toutes' || (mp.famille || '—') === familleActive)

        return (
          <>
            <div className="flex gap-1 p-1 rounded-lg bg-gray-100 mb-3 overflow-x-auto">
              <TabButton active={universActif === 'Tous'} onClick={() => { setUniversActif('Tous'); setFamilleActive('Toutes') }}>
                Tous <span className="text-xs text-gray-400 ml-1">{matieres.length}</span>
              </TabButton>
              {universDisponibles.map((u) => (
                <TabButton key={u} active={universActif === u} onClick={() => { setUniversActif(u); setFamilleActive('Toutes') }}>
                  {u} <span className="text-xs text-gray-400 ml-1">{matieres.filter((mp) => (mp.univers || 'Non catégorisé') === u).length}</span>
                </TabButton>
              ))}
            </div>

            {universActif !== 'Tous' && famillesDisponibles.length > 0 && (
              <div className="flex gap-1 p-1 rounded-lg bg-gray-50 border border-gray-100 mb-4 overflow-x-auto">
                <TabButton small active={familleActive === 'Toutes'} onClick={() => setFamilleActive('Toutes')}>Toutes</TabButton>
                {famillesDisponibles.map((f) => (
                  <TabButton small key={f} active={familleActive === f} onClick={() => setFamilleActive(f)}>{f}</TabButton>
                ))}
              </div>
            )}

            {filtrees.length === 0 ? (
              <p className="text-gray-400 text-sm">Aucune matière première{query ? ' pour cette recherche' : ', ajoutez-en une ou importez une facture'}.</p>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-2 px-1">
                  <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filtrees.length > 0 && filtrees.every((mp) => selection.has(mp.id))}
                      onChange={(e) => {
                        const next = new Set(selection)
                        if (e.target.checked) filtrees.forEach((mp) => next.add(mp.id))
                        else filtrees.forEach((mp) => next.delete(mp.id))
                        setSelection(next)
                      }}
                    />
                    Tout sélectionner {selection.size > 0 && `(${selection.size})`}
                  </label>
                  {selection.size > 0 && (
                    <button onClick={supprimerSelection} className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700">
                      <Trash2 size={13} /> Supprimer la sélection
                    </button>
                  )}
                </div>
                <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                  {filtrees.map((mp) => {
                    const cov = getCouvertureColor(mp.couverture_stock || 0, mp.seuil_rouge || 3, mp.seuil_orange || 7)
                    return (
                      <div key={mp.id} className="flex items-center justify-between gap-3 px-6 py-4 hover:bg-gray-50">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <input type="checkbox" className="shrink-0" checked={selection.has(mp.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelection(mp.id)} />
                          <span className={`w-2 h-2 rounded-full shrink-0 ${cov.dot}`} />
                          {mp.code && <span className="text-[10px] font-mono text-gray-400 shrink-0">{mp.code}</span>}
                          <span className="font-medium text-gray-800 cursor-pointer truncate" onClick={() => openDetail(mp)}>{mp.designation_interne}</span>
                          {universActif === 'Tous' && (mp.univers || mp.famille) && (
                            <span className="text-[10px] text-gray-400 truncate shrink whitespace-nowrap hidden lg:inline">{mp.univers || 'Non catégorisé'}{mp.famille ? ` · ${mp.famille}` : ''}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0 cursor-pointer" onClick={() => openDetail(mp)}>
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${cov.color}`}>
                            {mp.couverture_stock ? `${mp.couverture_stock}j` : 'Pas de données'}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-500 whitespace-nowrap">{mp.cmp ? `${mp.cmp.toFixed(5)}€` : '—'}</span>
                          <ChevronRight size={16} className="text-gray-400 shrink-0" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )
      })()}

      {/* Formulaire création */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-800">Nouvelle matière première</h3>
              <button onClick={() => setShowForm(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="space-y-4">
              <CategoryPicker categories={categories} univers={form.univers} famille={form.famille} onChange={(univers, famille) => setForm({ ...form, univers, famille })} />
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Désignation interne *</label>
                <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400" value={form.designation_interne} onChange={e => setForm({ ...form, designation_interne: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Unité (kg, L, pièce...)</label>
                <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400" value={form.unite} onChange={e => setForm({ ...form, unite: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Stock mini</label>
                <input type="number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400" value={form.stock_mini} onChange={e => setForm({ ...form, stock_mini: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Seuil rouge (jours)</label>
                  <input type="number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" value={form.seuil_rouge} onChange={e => setForm({ ...form, seuil_rouge: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Seuil orange (jours)</label>
                  <input type="number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" value={form.seuil_orange} onChange={e => setForm({ ...form, seuil_orange: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500">Annuler</button>
              <button onClick={saveMatierePremiere} className="px-6 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>Créer</button>
            </div>
          </div>
        </div>
      )}

      {/* Détail */}
      {showDetail && selected && (
        <MercurialeDetail
          mp={selected}
          fournisseurs={fournisseurs}
          categories={categories}
          liens={liens}
          mouvements={mouvements}
          correctionStock={correctionStock}
          setCorrectionStock={setCorrectionStock}
          onClose={() => setShowDetail(false)}
          onAddLink={(link) => addFournisseurLink(selected.id, link)}
          onSaveCorrection={saveCorrectionStock}
          onUpdateCategorie={updateCategorie}
          onDelete={deleteMatierePremiere}
          getCouvertureColor={getCouvertureColor}
        />
      )}

      {showSuggestionCategories && (
        <SuggestionCategoriesModal
          matieres={matieres.filter((mp) => !mp.univers)}
          categories={categories}
          onClose={() => setShowSuggestionCategories(false)}
          onDone={fetchAll}
        />
      )}
    </div>
  )
}


function MercurialeDetail({ mp, fournisseurs, categories, liens, mouvements, correctionStock, setCorrectionStock, onClose, onAddLink, onSaveCorrection, onUpdateCategorie, onDelete, getCouvertureColor }) {
  const [newLink, setNewLink] = useState(EMPTY_FOURNISSEUR_LINK)
  const cov = getCouvertureColor(mp.couverture_stock || 0, mp.seuil_rouge || 3, mp.seuil_orange || 7)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-8">
        <div className="flex items-center justify-between mb-4">
  <h3 className="text-lg font-bold text-gray-800">{mp.code && <span className="font-mono text-gray-400 mr-2">{mp.code}</span>}{mp.designation_interne}</h3>
  <div className="flex items-center gap-3">
    <button onClick={onDelete} className="text-sm text-red-500 hover:text-red-700 font-medium">Supprimer</button>
    <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
  </div>
</div>

        <div className="mb-6 max-w-md">
          <CategoryPicker categories={categories} univers={mp.univers} famille={mp.famille} onChange={onUpdateCategorie} />
        </div>

        {/* Indicateurs clés */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className={`rounded-lg p-3 ${cov.color}`}>
            <p className="text-xs opacity-70">Couverture stock</p>
            <p className="text-lg font-bold">{mp.couverture_stock ? `${mp.couverture_stock}j` : '—'}</p>
          </div>
          <div className="rounded-lg p-3 bg-gray-50 text-gray-600">
            <p className="text-xs opacity-70">Stock actuel</p>
            <p className="text-lg font-bold">{mp.quantite_stock || 0} {mp.unite}</p>
          </div>
          <div className="rounded-lg p-3 bg-red-50 text-red-600">
            <p className="text-xs opacity-70">CMUP</p>
            <p className="text-lg font-bold">{mp.cmp ? `${mp.cmp.toFixed(5)}€` : '—'}</p>
          </div>
          <div className="rounded-lg p-3 bg-gray-50 text-gray-600">
            <p className="text-xs opacity-70">Valeur stock</p>
            <p className="text-lg font-bold">{mp.valeur_stock || 0}€</p>
          </div>
        </div>

        {/* Fournisseurs liés */}
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Fournisseurs</h4>
        <div className="space-y-2 mb-4">
          {liens.length === 0 && <p className="text-sm text-gray-400">Aucun fournisseur lié.</p>}
          {liens.map(l => (
            <div key={l.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
              <div>
                <p className="font-medium text-gray-700">{l.fournisseurs?.nom}</p>
                <p className="text-xs text-gray-400">{l.designation_fournisseur} — Réf {l.reference_fournisseur}</p>
              </div>
              <div className="text-right">
                <p className="font-medium text-gray-700">{l.prix_actuel}€ / {l.conditionnement}{mp.unite}</p>
                <p className="text-xs text-gray-400">{l.prix_g_u_ml ? `${parseFloat(l.prix_g_u_ml).toFixed(6)}€/${mp.unite === 'kg' || mp.unite === 'L' ? (mp.unite === 'kg' ? 'g' : 'ml') : mp.unite || 'u'}` : ''}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Ajout fournisseur */}
        <div className="border border-gray-200 rounded-lg p-4 mb-6">
          <p className="text-xs font-medium text-gray-500 mb-3">Lier un fournisseur</p>
          <div className="grid grid-cols-2 gap-3">
            <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={newLink.fournisseur_id} onChange={e => setNewLink({ ...newLink, fournisseur_id: e.target.value })}>
              <option value="">Sélectionner fournisseur</option>
              {fournisseurs.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
            </select>
            <input placeholder="Réf. article fournisseur" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={newLink.reference_fournisseur} onChange={e => setNewLink({ ...newLink, reference_fournisseur: e.target.value })} />
            <input placeholder="Désignation fournisseur" className="border border-gray-200 rounded-lg px-3 py-2 text-sm col-span-2" value={newLink.designation_fournisseur} onChange={e => setNewLink({ ...newLink, designation_fournisseur: e.target.value })} />
            <input type="number" placeholder="Conditionnement" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={newLink.conditionnement} onChange={e => setNewLink({ ...newLink, conditionnement: e.target.value })} />
            <input type="number" placeholder="Prix (€)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={newLink.prix_actuel} onChange={e => setNewLink({ ...newLink, prix_actuel: e.target.value })} />
          </div>
          <button onClick={() => { onAddLink(newLink); setNewLink(EMPTY_FOURNISSEUR_LINK) }} className="mt-3 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
            Ajouter
          </button>
        </div>

        {/* Correction de stock */}
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Correction manuelle du stock</h4>
        <div className="border border-gray-200 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Ajustement (+ ou -)</label>
              <input type="number" placeholder="ex : -2 ou 5" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={correctionStock.quantite} onChange={e => setCorrectionStock({ ...correctionStock, quantite: e.target.value })} />
              <p className="text-[11px] text-gray-400 mt-1">
                S'ajoute au stock actuel ({mp.quantite_stock || 0}) — pas une valeur finale.
                {correctionStock.quantite !== '' && !isNaN(parseFloat(correctionStock.quantite)) && (
                  <> Nouveau stock : <b>{(mp.quantite_stock || 0) + parseFloat(correctionStock.quantite)}</b></>
                )}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Raison *</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={correctionStock.raison} onChange={e => setCorrectionStock({ ...correctionStock, raison: e.target.value })}>
                <option value="">Sélectionner</option>
                <option value="Inventaire">Inventaire</option>
                <option value="Destruction DLC">Destruction DLC</option>
                <option value="Incident production">Incident production</option>
                <option value="Erreur de saisie">Erreur de saisie</option>
              </select>
            </div>
          </div>
          <button onClick={onSaveCorrection} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
            Enregistrer la correction
          </button>
        </div>

        {/* Historique mouvements */}
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Historique des mouvements</h4>
        <div className="space-y-1">
          {mouvements.length === 0 && <p className="text-sm text-gray-400">Aucun mouvement enregistré.</p>}
          {mouvements.map(m => (
            <div key={m.id} className="flex items-center justify-between text-sm p-2 border-b border-gray-100">
              <div>
                <span className="text-gray-600">{m.type} {m.raison ? `— ${m.raison}` : ''}</span>
                <p className="text-xs text-gray-400">{new Date(m.date_mouvement).toLocaleDateString('fr-FR')}</p>
              </div>
              <span className={`font-medium flex items-center gap-1 ${m.quantite >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {m.quantite >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {m.quantite > 0 ? '+' : ''}{m.quantite}{mp.unite || ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, small, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md font-medium whitespace-nowrap transition-colors ${small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
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