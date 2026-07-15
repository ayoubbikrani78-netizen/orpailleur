import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, ChevronRight, X } from 'lucide-react'

const EMPTY_FORM = {
  nom: '', adresse: '', telephone: '', email: '',
  siret: '', siren: '', delai_paiement: '',
  franco_type: 'montant', franco_valeur: '',
  frais_port_type: 'fixe', frais_port_montant: '', frais_port_texte: '',
  etat: 'actif'
}

export default function Fournisseurs() {
  const [fournisseurs, setFournisseurs] = useState([])
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchFournisseurs() }, [])

  async function fetchFournisseurs() {
    const { data } = await supabase
      .from('fournisseurs')
      .select('*')
      .order('etat', { ascending: false })
      .order('nom')

    const { data: factures } = await supabase
      .from('factures')
      .select('fournisseur_id, montant_total_ht, created_at, date_facture')
      .eq('statut', 'validee')

    const montantTotal = (factures || []).reduce((sum, f) => sum + (parseFloat(f.montant_total_ht) || 0), 0)

    const stats = {}
    for (const f of (factures || [])) {
      if (!f.fournisseur_id) continue
      if (!stats[f.fournisseur_id]) stats[f.fournisseur_id] = { nb_factures: 0, montant_total: 0, dernier_achat: null }
      stats[f.fournisseur_id].nb_factures++
      stats[f.fournisseur_id].montant_total += parseFloat(f.montant_total_ht) || 0
      // On se base sur la date réelle de la facture (date_facture), pas sur la date d'import (created_at),
      // sinon une facture de mai importée en juillet apparaîtrait comme l'achat le plus récent à tort.
      const dateAchat = f.date_facture || f.created_at
      if (!stats[f.fournisseur_id].dernier_achat || dateAchat > stats[f.fournisseur_id].dernier_achat) {
        stats[f.fournisseur_id].dernier_achat = dateAchat
      }
    }

    const fournisseursAvecStats = (data || []).map(f => ({
      ...f,
      nb_factures: stats[f.id]?.nb_factures || 0,
      montant_total: stats[f.id]?.montant_total || 0,
      dernier_achat: stats[f.id]?.dernier_achat || null,
      poids_pct: montantTotal > 0 ? ((stats[f.id]?.montant_total || 0) / montantTotal * 100).toFixed(1) : 0
    }))

    setFournisseurs(fournisseursAvecStats)
    setLoading(false)
  }

  async function saveFournisseur() {
    if (!form.nom) return alert('Le nom est obligatoire')
    if (selected) {
      await supabase.from('fournisseurs').update(form).eq('id', selected.id)
    } else {
      await supabase.from('fournisseurs').insert(form)
    }
    setShowForm(false)
    setSelected(null)
    setForm(EMPTY_FORM)
    fetchFournisseurs()
  }

async function deleteFournisseur() {
  if (!window.confirm('Supprimer ce fournisseur ? Toutes ses commandes, factures et liaisons mercuriale seront aussi supprimées.')) return

  const { data: commandes } = await supabase.from('commandes').select('id').eq('fournisseur_id', selected.id)
  const commandeIds = (commandes || []).map(c => c.id)
  if (commandeIds.length > 0) {
    await supabase.from('commandes_lignes').delete().in('commande_id', commandeIds)
    await supabase.from('commandes').delete().in('id', commandeIds)
  }

  const { data: liens } = await supabase.from('matieres_premieres_fournisseurs').select('id').eq('fournisseur_id', selected.id)
  const liensIds = (liens || []).map(l => l.id)
  if (liensIds.length > 0) {
    await supabase.from('commandes_lignes').delete().in('matiere_premiere_fournisseur_id', liensIds)
    await supabase.from('matieres_premieres_fournisseurs').delete().eq('fournisseur_id', selected.id)
  }

  await supabase.from('factures').delete().eq('fournisseur_id', selected.id)
  await supabase.from('alertes').delete().eq('fournisseur_nom', selected.nom)

  await supabase.from('fournisseurs').delete().eq('id', selected.id)
  setShowForm(false)
  setSelected(null)
  setForm(EMPTY_FORM)
  fetchFournisseurs()
}

  async function toggleEtat(f) {
    const nouvelEtat = f.etat === 'actif' ? 'inactif' : 'actif'
    await supabase.from('fournisseurs').update({ etat: nouvelEtat }).eq('id', f.id)
    fetchFournisseurs()
  }

  function openEdit(f) {
    setSelected(f)
    setForm({ ...f, frais_port_type: f.frais_port_type || 'fixe', franco_type: f.franco_type || 'montant' })
    setShowForm(true)
  }

  function openNew() {
    setSelected(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Catalogue fournisseurs</h2>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
          <Plus size={16} /> Ajouter
        </button>
      </div>

      {loading ? <p className="text-gray-400">Chargement...</p> : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {fournisseurs.length === 0 && (
            <p className="p-6 text-gray-400 text-sm">Aucun fournisseur. Ajoutez-en un.</p>
          )}
          {fournisseurs.map(f => (
            <div key={f.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 cursor-pointer" onClick={() => openEdit(f)}>
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${f.etat === 'actif' ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span className="font-medium text-gray-800">{f.nom}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${f.etat === 'actif' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                  {f.etat === 'actif' ? 'Actif' : 'Inactif'}
                </span>
                <ChevronRight size={16} className="text-gray-400" />
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-800">{selected ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}</h3>
              <button onClick={() => setShowForm(false)}><X size={20} className="text-gray-400" /></button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Nom *', key: 'nom', full: true },
                { label: 'Adresse', key: 'adresse', full: true },
                { label: 'Téléphone', key: 'telephone' },
                { label: 'Email', key: 'email' },
                { label: 'SIRET', key: 'siret' },
                { label: 'SIREN', key: 'siren' },
                { label: 'Délai de paiement (jours)', key: 'delai_paiement' },
              ].map(({ label, key, full }) => (
                <div key={key} className={full ? 'col-span-2' : ''}>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
                    value={form[key] || ''}
                    onChange={e => setForm({ ...form, [key]: e.target.value })}
                  />
                </div>
              ))}

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Type franco de port</label>
                <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" value={form.franco_type} onChange={e => setForm({ ...form, franco_type: e.target.value })}>
                  <option value="montant">Montant (€)</option>
                  <option value="volume">Volume (kg)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Seuil franco</label>
                <input type="number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" value={form.franco_valeur || ''} onChange={e => setForm({ ...form, franco_valeur: e.target.value })} />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Type frais de port</label>
                <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" value={form.frais_port_type} onChange={e => setForm({ ...form, frais_port_type: e.target.value })}>
                  <option value="fixe">Fixe</option>
                  <option value="variable">Variable</option>
                </select>
              </div>
              {form.frais_port_type === 'fixe' ? (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Montant frais de port (€)</label>
                  <input type="number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" value={form.frais_port_montant || ''} onChange={e => setForm({ ...form, frais_port_montant: e.target.value })} />
                </div>
              ) : (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Description frais de port</label>
                  <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" value={form.frais_port_texte || ''} onChange={e => setForm({ ...form, frais_port_texte: e.target.value })} />
                </div>
              )}

              {selected && (
                <>
                  <div className="col-span-2 flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">Statut du fournisseur</span>
                    <button onClick={() => { toggleEtat(selected); setShowForm(false) }} className={`text-xs px-3 py-1.5 rounded-full font-medium ${selected.etat === 'actif' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
                      Passer {selected.etat === 'actif' ? 'Inactif' : 'Actif'}
                    </button>
                  </div>
                  <div className="col-span-2 grid grid-cols-4 gap-3">
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                      <p className="text-xs text-gray-400 mb-1">Factures</p>
                      <p className="font-bold text-gray-800">{selected.nb_factures || 0}</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                      <p className="text-xs text-gray-400 mb-1">Montant total</p>
                      <p className="font-bold text-gray-800">{parseFloat(selected.montant_total || 0).toFixed(0)}€</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                      <p className="text-xs text-gray-400 mb-1">Poids achats</p>
                      <p className="font-bold text-gray-800">{selected.poids_pct || 0}%</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                      <p className="text-xs text-gray-400 mb-1">Dernier achat</p>
                      <p className="font-bold text-gray-800">{selected.dernier_achat ? new Date(selected.dernier_achat).toLocaleDateString('fr-FR') : '—'}</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-between items-center mt-6">
  {selected && (
    <button onClick={deleteFournisseur} className="px-4 py-2 text-sm text-red-500 hover:text-red-700">
      Supprimer
    </button>
  )}
  <div className="flex gap-3 ml-auto">
    <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Annuler</button>
    <button onClick={saveFournisseur} className="px-6 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
      {selected ? 'Enregistrer' : 'Créer'}
    </button>
  </div>
</div>
          </div>
        </div>
      )}
    </div>
  )
}