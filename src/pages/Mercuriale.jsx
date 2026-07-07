import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, ChevronRight, X, TrendingUp, TrendingDown } from 'lucide-react'

const EMPTY_MP = {
  categorie_nom: '', designation_interne: '', unite: '', stock_mini: '',
  seuil_rouge: 3, seuil_orange: 7
}

const EMPTY_FOURNISSEUR_LINK = {
  fournisseur_id: '', reference_fournisseur: '', designation_fournisseur: '',
  conditionnement: '', prix_actuel: ''
}

export default function Mercuriale() {
  const [matieres, setMatieres] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY_MP)
  const [liens, setLiens] = useState([])
  const [mouvements, setMouvements] = useState([])
  const [correctionStock, setCorrectionStock] = useState({ quantite: '', raison: '' })

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const { data: mp } = await supabase.from('matieres_premieres').select('*').order('designation_interne')
    const { data: f } = await supabase.from('fournisseurs').select('*').eq('etat', 'actif').order('nom')
    setMatieres(mp || [])
    setFournisseurs(f || [])
    setLoading(false)
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
    await supabase.from('matieres_premieres').insert({
      designation_interne: form.designation_interne,
      unite: form.unite,
      stock_mini: form.stock_mini || 0,
      seuil_rouge: form.seuil_rouge,
      seuil_orange: form.seuil_orange
    })
    setShowForm(false)
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

  async function addFournisseurLink(mpId, link) {
    if (!link.fournisseur_id || !link.designation_fournisseur) return alert('Fournisseur et désignation requis')
    await supabase.from('matieres_premieres_fournisseurs').insert({
      matiere_premiere_id: mpId,
      fournisseur_id: link.fournisseur_id,
      reference_fournisseur: link.reference_fournisseur,
      designation_fournisseur: link.designation_fournisseur,
      conditionnement: link.conditionnement,
      prix_actuel: link.prix_actuel,
      prix_initial: link.prix_actuel,
      prix_g_u_ml: link.conditionnement ? (link.prix_actuel / link.conditionnement) : 0
    })
    openDetail(selected)
  }

  async function saveCorrectionStock() {
    if (!correctionStock.raison) return alert('La raison de la correction est obligatoire')
    const ancienneQte = selected.quantite_stock || 0
    const nouvelleQte = parseFloat(correctionStock.quantite)
    const diff = nouvelleQte - ancienneQte

    await supabase.from('mouvements_stock').insert({
      matiere_premiere_id: selected.id,
      type: 'correction',
      quantite: diff,
      raison: correctionStock.raison
    })
    await supabase.from('matieres_premieres').update({ quantite_stock: nouvelleQte }).eq('id', selected.id)
    openDetail({ ...selected, quantite_stock: nouvelleQte })
    fetchAll()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Mercuriale</h2>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
          <Plus size={16} /> Ajouter une matière première
        </button>
      </div>

      {loading ? <p className="text-gray-400">Chargement...</p> : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {matieres.length === 0 && <p className="p-6 text-gray-400 text-sm">Aucune matière première. Ajoutez-en une ou importez une facture.</p>}
          {matieres.map(mp => {
            const cov = getCouvertureColor(mp.couverture_stock || 0, mp.seuil_rouge || 3, mp.seuil_orange || 7)
            return (
              <div key={mp.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(mp)}>
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${cov.dot}`} />
                  <span className="font-medium text-gray-800">{mp.designation_interne}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${cov.color}`}>
                    {mp.couverture_stock ? `${mp.couverture_stock}j de stock` : 'Pas encore de données'}
                  </span>
                  <span className="text-xs text-gray-400">CMP : {mp.cmp ? `${mp.cmp}€` : '—'}</span>
                  <ChevronRight size={16} className="text-gray-400" />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Formulaire création */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-800">Nouvelle matière première</h3>
              <button onClick={() => setShowForm(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <div className="space-y-4">
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
          liens={liens}
          mouvements={mouvements}
          correctionStock={correctionStock}
          setCorrectionStock={setCorrectionStock}
          onClose={() => setShowDetail(false)}
          onAddLink={(link) => addFournisseurLink(selected.id, link)}
          onSaveCorrection={saveCorrectionStock}
          onDelete={deleteMatierePremiere}
          getCouvertureColor={getCouvertureColor}
        />
      )}
    </div>
  )
}

function MercurialeDetail({ mp, fournisseurs, liens, mouvements, correctionStock, setCorrectionStock, onClose, onAddLink, onSaveCorrection, onDelete, getCouvertureColor }) {
  const [newLink, setNewLink] = useState(EMPTY_FOURNISSEUR_LINK)
  const cov = getCouvertureColor(mp.couverture_stock || 0, mp.seuil_rouge || 3, mp.seuil_orange || 7)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-8">
        <div className="flex items-center justify-between mb-6">
  <h3 className="text-lg font-bold text-gray-800">{mp.designation_interne}</h3>
  <div className="flex items-center gap-3">
    <button onClick={onDelete} className="text-sm text-red-500 hover:text-red-700 font-medium">Supprimer</button>
    <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
  </div>
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
          <div className="rounded-lg p-3 bg-gray-50 text-gray-600">
            <p className="text-xs opacity-70">CMP</p>
            <p className="text-lg font-bold">{mp.cmp ? `${mp.cmp}€` : '—'}</p>
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
                <p className="text-xs text-gray-400">{l.prix_g_u_ml ? `${parseFloat(l.prix_g_u_ml).toFixed(4)}€/u` : ''}</p>
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
              <label className="text-xs font-medium text-gray-500 mb-1 block">Nouvelle quantité</label>
              <input type="number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={correctionStock.quantite} onChange={e => setCorrectionStock({ ...correctionStock, quantite: e.target.value })} />
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
              <span className="text-gray-600">{m.type} {m.raison ? `— ${m.raison}` : ''}</span>
              <span className={`font-medium flex items-center gap-1 ${m.quantite >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {m.quantite >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {m.quantite}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}