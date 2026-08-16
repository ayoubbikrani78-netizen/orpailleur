import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Building2, Percent, Users, Flame, Plus, Trash2 } from 'lucide-react'

const TABS = [
  { id: 'boulangerie', label: 'Informations boulangerie', icon: Building2 },
  { id: 'taux', label: 'Taux & seuils', icon: Percent },
  { id: 'ateliers', label: 'Ateliers', icon: Users },
  { id: 'bareme', label: 'Barème énergie', icon: Flame },
]

export default function Reglages() {
  const [tab, setTab] = useState('boulangerie')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Paramètres</h2>
      </div>

      <div className="flex gap-1 p-1 rounded-lg bg-gray-100 mb-6 w-fit">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors"
              style={{
                backgroundColor: tab === t.id ? '#FFFFFF' : 'transparent',
                color: tab === t.id ? '#1F2937' : '#6B7280',
                boxShadow: tab === t.id ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'boulangerie' && <OngletBoulangerie />}
      {tab === 'taux' && <OngletTauxSeuils />}
      {tab === 'ateliers' && <OngletAteliers />}
      {tab === 'bareme' && <OngletBareme />}
    </div>
  )
}

// ---------------------------------------------------------------
// Onglet 1 : Informations boulangerie (inchangé, juste déplacé)
// ---------------------------------------------------------------
function OngletBoulangerie() {
  const [form, setForm] = useState({
    nom_boulangerie: '', adresse: '', telephone: '', email: '',
    siret: '', siren: '', emails_secondaires: ''
  })
  const [reglagesId, setReglagesId] = useState(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState(null)

  useEffect(() => { fetchReglages() }, [])

  async function fetchReglages() {
    const { data, error } = await supabase.from('reglages').select('*').limit(1).maybeSingle()
    if (error) { console.error('Erreur chargement réglages:', error); return }
    if (data) {
      setReglagesId(data.id)
      setForm({
        nom_boulangerie: data.nom_boulangerie || '',
        adresse: data.adresse || '',
        telephone: data.telephone || '',
        email: data.email || '',
        siret: data.siret || '',
        siren: data.siren || '',
        emails_secondaires: data.emails_secondaires || ''
      })
    }
  }

  async function saveReglages() {
    if (saving) return
    setSaving(true)
    setErreur(null)
    try {
      let error
      if (reglagesId) {
        ({ error } = await supabase.from('reglages').update(form).eq('id', reglagesId))
      } else {
        const res = await supabase.from('reglages').insert(form).select().single()
        error = res.error
        if (!error && res.data) setReglagesId(res.data.id)
      }
      if (error) { setErreur(error.message || "Échec de l'enregistrement, réessaie."); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-2xl">
      <h3 className="text-sm font-semibold text-gray-700 mb-6">Informations de la boulangerie</h3>
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Nom de la boulangerie', key: 'nom_boulangerie', full: true },
          { label: 'Adresse', key: 'adresse', full: true },
          { label: 'Téléphone', key: 'telephone' },
          { label: 'Email', key: 'email' },
          { label: 'SIRET', key: 'siret' },
          { label: 'SIREN', key: 'siren' },
        ].map(({ label, key, full }) => (
          <div key={key} className={full ? 'col-span-2' : ''}>
            <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </div>
        ))}
        <div className="col-span-2 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Destinataires secondaires</h3>
          <p className="text-xs text-gray-400 mb-2">Emails séparés par des virgules (ex : comptable@cabinet.fr, associe@boulangerie.fr)</p>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
            placeholder="email1@exemple.fr, email2@exemple.fr"
            value={form.emails_secondaires}
            onChange={(e) => setForm({ ...form, emails_secondaires: e.target.value })}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-6">
        <button onClick={saveReglages} disabled={saving} className="px-6 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60" style={{ backgroundColor: '#C9A84C' }}>
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        {saved && <span className="text-sm text-green-500 font-medium">✓ Sauvegardé</span>}
        {erreur && <span className="text-sm text-red-500 font-medium">{erreur}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Onglet 2 : Taux & seuils (repris intégralement de l'Excel)
// ---------------------------------------------------------------
const CHAMPS_TAUX = [
  { key: 'tva_defaut', label: 'TVA par défaut (à emporter)', suffix: '%', aide: "Snack/pizza/boisson : souvent 10% (sur place) ou 20% (alcool) — à régler par produit" },
  { key: 'tva_sur_place', label: 'TVA sur place', suffix: '%' },
  { key: 'perte_defaut', label: 'Perte / freinte (global)', suffix: '%', aide: 'Surchargeable par produit' },
  { key: 'seuil_alerte_prix', label: 'Seuil alerte écart prix', suffix: '%' },
  { key: 'seuil_marge', label: 'Seuil alerte marge (taux de marque mini)', suffix: '%' },
  { key: 'seuil_ecart_pvmo_pvmd', label: 'Seuil alerte écart PVMO/PVMD', suffix: '%' },
  { key: 'heures_mensuelles', label: 'Heures mensuelles (base 35h)', suffix: 'h' },
]

function OngletTauxSeuils() {
  const [form, setForm] = useState({})
  const [reglagesId, setReglagesId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { fetchReglages() }, [])

  async function fetchReglages() {
    const { data } = await supabase.from('reglages').select('*').limit(1).maybeSingle()
    if (data) {
      setReglagesId(data.id)
      const f = {}
      for (const c of CHAMPS_TAUX) {
        const val = data[c.key]
        f[c.key] = c.suffix === '%' ? (val != null ? val * 100 : '') : (val ?? '')
      }
      setForm(f)
    }
  }

  async function save() {
    setSaving(true)
    const patch = {}
    for (const c of CHAMPS_TAUX) {
      const val = form[c.key]
      patch[c.key] = val === '' ? null : (c.suffix === '%' ? parseFloat(val) / 100 : parseFloat(val))
    }
    if (reglagesId) {
      await supabase.from('reglages').update(patch).eq('id', reglagesId)
    } else {
      const { data } = await supabase.from('reglages').insert(patch).select().single()
      if (data) setReglagesId(data.id)
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-2xl">
      <h3 className="text-sm font-semibold text-gray-700 mb-6">Taux & seuils</h3>
      <div className="space-y-4">
        {CHAMPS_TAUX.map((c) => (
          <div key={c.key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-gray-700">{c.label}</p>
              {c.aide && <p className="text-xs text-gray-400 mt-0.5">{c.aide}</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number" step="0.01"
                className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right"
                value={form[c.key] ?? ''}
                onChange={(e) => setForm({ ...form, [c.key]: e.target.value })}
              />
              <span className="text-xs text-gray-400 w-4">{c.suffix}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-6">
        <button onClick={save} disabled={saving} className="px-6 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60" style={{ backgroundColor: '#C9A84C' }}>
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        {saved && <span className="text-sm text-green-500 font-medium">✓ Sauvegardé</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Onglet 3 : Ateliers (taux horaire par atelier — CRUD)
// ---------------------------------------------------------------
function OngletAteliers() {
  const [ateliers, setAteliers] = useState([])
  const [nouveau, setNouveau] = useState({ nom: '', taux_horaire: '' })

  useEffect(() => { fetchAteliers() }, [])

  async function fetchAteliers() {
    const { data } = await supabase.from('ateliers').select('*').order('nom')
    setAteliers(data || [])
  }

  async function updateTaux(id, taux_horaire) {
    await supabase.from('ateliers').update({ taux_horaire: parseFloat(taux_horaire) || 0 }).eq('id', id)
    fetchAteliers()
  }

  async function renommer(id, nom) {
    await supabase.from('ateliers').update({ nom }).eq('id', id)
    fetchAteliers()
  }

  async function supprimer(id) {
    if (!window.confirm("Supprimer cet atelier ? Les recettes qui l'utilisent perdront leur lien.")) return
    await supabase.from('ateliers').delete().eq('id', id)
    fetchAteliers()
  }

  async function ajouter() {
    if (!nouveau.nom) return
    await supabase.from('ateliers').insert({ nom: nouveau.nom, taux_horaire: parseFloat(nouveau.taux_horaire) || 0 })
    setNouveau({ nom: '', taux_horaire: '' })
    fetchAteliers()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-2xl">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Taux horaire par atelier</h3>
      <p className="text-xs text-gray-400 mb-6">€/h chargé — utilisé pour calculer la main d'œuvre dans le coût de revient</p>
      <div className="space-y-2">
        {ateliers.map((a) => (
          <div key={a.id} className="flex items-center gap-3">
            <input
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              defaultValue={a.nom}
              onBlur={(e) => e.target.value !== a.nom && renommer(a.id, e.target.value)}
            />
            <div className="flex items-center gap-1">
              <input
                type="number" step="0.01"
                className="w-24 border border-gray-200 rounded-lg px-2 py-2 text-sm text-right"
                defaultValue={a.taux_horaire}
                onBlur={(e) => parseFloat(e.target.value) !== a.taux_horaire && updateTaux(a.id, e.target.value)}
              />
              <span className="text-xs text-gray-400">€/h</span>
            </div>
            <button onClick={() => supprimer(a.id)}><Trash2 size={15} className="text-gray-300 hover:text-red-500" /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
        <input placeholder="Nom de l'atelier" className="flex-1 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm" value={nouveau.nom} onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} />
        <input type="number" step="0.01" placeholder="€/h" className="w-24 border border-dashed border-gray-300 rounded-lg px-2 py-2 text-sm text-right" value={nouveau.taux_horaire} onChange={(e) => setNouveau({ ...nouveau, taux_horaire: e.target.value })} />
        <button onClick={ajouter} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 border border-dashed border-gray-300"><Plus size={14} /> Ajouter</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Onglet 4 : Barème énergie (coût forfaitaire par palier de cuisson — CRUD)
// ---------------------------------------------------------------
function OngletBareme() {
  const [bareme, setBareme] = useState([])
  const [nouveau, setNouveau] = useState({ tps_cuisson_min: '', cout: '' })

  useEffect(() => { fetchBareme() }, [])

  async function fetchBareme() {
    const { data } = await supabase.from('bareme_energie').select('*').order('tps_cuisson_min')
    setBareme(data || [])
  }

  async function updateLigne(id, patch) {
    await supabase.from('bareme_energie').update(patch).eq('id', id)
    fetchBareme()
  }

  async function supprimer(id) {
    await supabase.from('bareme_energie').delete().eq('id', id)
    fetchBareme()
  }

  async function ajouter() {
    if (nouveau.tps_cuisson_min === '' || nouveau.cout === '') return
    await supabase.from('bareme_energie').insert({
      tps_cuisson_min: parseFloat(nouveau.tps_cuisson_min),
      cout: parseFloat(nouveau.cout),
    })
    setNouveau({ tps_cuisson_min: '', cout: '' })
    fetchBareme()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-xl">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Barème énergie cuisson</h3>
      <p className="text-xs text-gray-400 mb-6">Coût forfaitaire (€/fournée) selon la durée de cuisson — le palier appliqué est le plus grand seuil atteint</p>
      <div className="space-y-2">
        <div className="flex items-center gap-3 text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">
          <span className="flex-1">Temps de cuisson (min)</span>
          <span className="w-28 text-right">Coût (€)</span>
          <span className="w-6"></span>
        </div>
        {bareme.map((b) => (
          <div key={b.id} className="flex items-center gap-3">
            <input
              type="number"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              defaultValue={b.tps_cuisson_min}
              onBlur={(e) => parseFloat(e.target.value) !== b.tps_cuisson_min && updateLigne(b.id, { tps_cuisson_min: parseFloat(e.target.value) })}
            />
            <input
              type="number" step="0.001"
              className="w-28 border border-gray-200 rounded-lg px-2 py-2 text-sm text-right"
              defaultValue={b.cout}
              onBlur={(e) => parseFloat(e.target.value) !== b.cout && updateLigne(b.id, { cout: parseFloat(e.target.value) })}
            />
            <button onClick={() => supprimer(b.id)}><Trash2 size={15} className="text-gray-300 hover:text-red-500" /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
        <input type="number" placeholder="Min" className="flex-1 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm" value={nouveau.tps_cuisson_min} onChange={(e) => setNouveau({ ...nouveau, tps_cuisson_min: e.target.value })} />
        <input type="number" step="0.001" placeholder="€" className="w-28 border border-dashed border-gray-300 rounded-lg px-2 py-2 text-sm text-right" value={nouveau.cout} onChange={(e) => setNouveau({ ...nouveau, cout: e.target.value })} />
        <button onClick={ajouter} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 border border-dashed border-gray-300"><Plus size={14} /></button>
      </div>
    </div>
  )
}
