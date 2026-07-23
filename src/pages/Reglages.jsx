import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Reglages() {
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
    if (error) {
      console.error('Erreur chargement réglages:', error)
      return
    }
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
      if (error) {
        console.error('Erreur sauvegarde réglages:', error)
        setErreur(error.message || "Échec de l'enregistrement, réessaie.")
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Réglages</h2>
      </div>

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
                onChange={e => setForm({ ...form, [key]: e.target.value })}
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
              onChange={e => setForm({ ...form, emails_secondaires: e.target.value })}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={saveReglages}
            disabled={saving}
            className="px-6 py-2 rounded-lg text-white text-sm font-medium cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#C9A84C' }}
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          {saved && <span className="text-sm text-green-500 font-medium">✓ Sauvegardé</span>}
          {erreur && <span className="text-sm text-red-500 font-medium">{erreur}</span>}
        </div>
      </div>
    </div>
  )
}