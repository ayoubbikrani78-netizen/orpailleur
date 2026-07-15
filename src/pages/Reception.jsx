import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ChevronRight, X, AlertTriangle, Check, Upload, Loader } from 'lucide-react'
import { extractInvoiceData, fileToBase64 } from '../lib/ocr'

function normalizeDate(dateStr) {
  if (!dateStr) return null
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (match) return `${match[3]}-${match[2]}-${match[1]}`
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return dateStr
  return null
}

export default function Reception() {
  const [commandes, setCommandes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const [lignes, setLignes] = useState([])
  const [factures, setFactures] = useState([])
  const [factureSelectionnee, setFactureSelectionnee] = useState(null)
  const [dateReception, setDateReception] = useState(new Date().toISOString().split('T')[0])
  const [historique, setHistorique] = useState([])
  const [uploadingFacture, setUploadingFacture] = useState(false)

  useEffect(() => { fetchCommandes() }, [])

  async function fetchCommandes() {
    const { data: c } = await supabase
      .from('commandes')
      .select('*, fournisseurs(nom, delai_paiement)')
      .eq('statut', 'envoyee')
      .order('created_at', { ascending: false })
    setCommandes(c || [])

    const { data: h } = await supabase
      .from('commandes')
      .select('*, fournisseurs(nom)')
      .eq('statut', 'receptionnee')
      .order('date_reception', { ascending: false })
      .limit(20)
    setHistorique(h || [])
    setLoading(false)
  }

  async function openDetail(commande) {
    setSelected(commande)
    const { data: l } = await supabase
      .from('commandes_lignes')
      .select('*, matieres_premieres_fournisseurs(designation_fournisseur, reference_fournisseur, conditionnement, matiere_premiere_id, matieres_premieres(designation_interne, unite))')
      .eq('commande_id', commande.id)
    setLignes((l || []).map(ligne => ({ ...ligne, quantite_receptionnee: ligne.quantite_commandee })))

    const { data: f } = await supabase
      .from('factures')
      .select('*')
      .eq('fournisseur_id', commande.fournisseur_id)
      .order('created_at', { ascending: false })
      .limit(10)
    setFactures(f || [])
    setFactureSelectionnee(null)
    setShowDetail(true)
  }

async function openDetail(commande) {
    setSelected(commande)
    const { data: l } = await supabase
      .from('commandes_lignes')
      .select('*, matieres_premieres_fournisseurs(designation_fournisseur, reference_fournisseur, conditionnement, matiere_premiere_id, matieres_premieres(designation_interne, unite))')
      .eq('commande_id', commande.id)
    setLignes((l || []).map(ligne => ({ ...ligne, quantite_receptionnee: ligne.quantite_commandee })))

    const { data: f } = await supabase
      .from('factures')
      .select('*')
      .eq('fournisseur_id', commande.fournisseur_id)
      .order('created_at', { ascending: false })
      .limit(10)
    setFactures(f || [])
    setFactureSelectionnee(null)
    setShowDetail(true)
  }

  async function importerFactureDepuisReception(file) {
    if (file.type !== 'application/pdf') return alert('Veuillez importer un fichier PDF.')
    setUploadingFacture(true)
    const base64 = await fileToBase64(file)
    const { data: factureInserted } = await supabase
      .from('factures')
      .insert({ statut: 'en_cours', fichier_url: base64, fournisseur_id: selected.fournisseur_id })
      .select()
      .single()

    try {
      const { extracted, needsReview, confidence } = await extractInvoiceData(base64)

      await supabase.from('factures').update({
        numero: extracted.facture?.numero,
        date_facture: normalizeDate(extracted.facture?.date),
        montant_total_ht: extracted.facture?.montant_total_ht,
        montant_total_ttc: extracted.facture?.montant_total_ttc,
        lignes_extraites: JSON.stringify(extracted.lignes || []),
        statut: needsReview ? 'a_verifier' : 'validee',
        extraction_incomplete: needsReview,
        confiance_ocr: confidence
      }).eq('id', factureInserted.id)

      const { data: nouvelleFacture } = await supabase.from('factures').select('*').eq('id', factureInserted.id).single()
      setFactures([nouvelleFacture, ...factures])
      setFactureSelectionnee(nouvelleFacture)
    } catch (e) {
      await supabase.from('factures').update({
        statut: 'a_verifier',
        extraction_incomplete: true,
        confiance_ocr: 0
      }).eq('id', factureInserted.id)
    }
    setUploadingFacture(false)
  }

  function updateQuantiteReceptionnee(ligneId, qte) {
    setLignes(lignes.map(l => l.id === ligneId ? { ...l, quantite_receptionnee: qte } : l))
  }

  function calculerEcarts() {
    const ecartCommande = lignes.reduce((sum, l) => sum + ((l.quantite_commandee || 0) - (l.quantite_receptionnee || 0)), 0)
    const montantAttendu = lignes.reduce((sum, l) => sum + ((l.quantite_receptionnee || 0) * (l.prix_unitaire_ht || 0)), 0)
    const montantFacture = factureSelectionnee?.montant_total_ht || 0
    const ecartMontant = montantAttendu - montantFacture
    return { ecartCommande, montantAttendu, montantFacture, ecartMontant }
  }

  async function validerReception() {
    const ecarts = calculerEcarts()

    for (const ligne of lignes) {
      await supabase.from('commandes_lignes').update({
        quantite_receptionnee: ligne.quantite_receptionnee,
        facture_id: factureSelectionnee?.id || null
      }).eq('id', ligne.id)

      if (ligne.matieres_premieres_fournisseurs?.matiere_premiere_id) {
        const mpId = ligne.matieres_premieres_fournisseurs.matiere_premiere_id
        const conditionnement = ligne.matieres_premieres_fournisseurs.conditionnement || 1
        const quantiteEnUnite = (ligne.quantite_receptionnee || 0) * conditionnement

        const { data: mp } = await supabase.from('matieres_premieres').select('quantite_stock').eq('id', mpId).single()
        const nouveauStock = (mp?.quantite_stock || 0) + quantiteEnUnite

        await supabase.from('matieres_premieres').update({ quantite_stock: nouveauStock }).eq('id', mpId)
        await supabase.from('mouvements_stock').insert({
          matiere_premiere_id: mpId,
          type: 'reception',
          quantite: quantiteEnUnite,
          raison: `Réception commande ${selected.fournisseurs?.nom}`
        })
      }
    }

    let delaiPaiement = selected.fournisseurs?.delai_paiement || 0
    let datePaiement = new Date(dateReception)
    datePaiement.setDate(datePaiement.getDate() + parseInt(delaiPaiement))

    await supabase.from('commandes').update({
      statut: 'receptionnee',
      date_reception: dateReception
    }).eq('id', selected.id)

    if (Math.abs(ecarts.ecartMontant) > 0.5) {
      await supabase.from('alertes').insert({
        type: 'ecart_prix',
        message: `Écart de ${ecarts.ecartMontant.toFixed(2)}€ détecté sur la réception ${selected.fournisseurs?.nom}`,
        reference_id: selected.id,
        reference_table: 'commandes'
      })
    }

    setShowDetail(false)
    fetchCommandes()
  }

  const ecarts = selected ? calculerEcarts() : null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Réception commandes</h2>
      </div>

      {loading ? <p className="text-gray-400">Chargement...</p> : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {commandes.length === 0 && <p className="p-6 text-gray-400 text-sm">Aucune commande en attente de réception.</p>}
          {commandes.map(c => (
            <div key={c.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(c)}>
              <div>
                <p className="font-medium text-gray-800 text-sm">{c.fournisseurs?.nom}</p>
                <p className="text-xs text-gray-400">Commandée le {new Date(c.created_at).toLocaleDateString()} — {parseFloat(c.montant_total_ht || 0).toFixed(2)}€ HT</p>
              </div>
              <ChevronRight size={16} className="text-gray-400" />
            </div>
          ))}
        </div>
      )}

      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mt-10 mb-3">Historique des réceptions</h3>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {historique.length === 0 && <p className="p-6 text-gray-400 text-sm">Aucune réception enregistrée.</p>}
        {historique.map(c => (
          <div key={c.id} className="flex items-center justify-between px-6 py-4">
            <div>
              <p className="font-medium text-gray-700 text-sm">{c.fournisseurs?.nom}</p>
              <p className="text-xs text-gray-400">Réceptionnée le {c.date_reception ? new Date(c.date_reception).toLocaleDateString() : '—'}</p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-50 text-green-600">{parseFloat(c.montant_total_ht || 0).toFixed(2)}€ HT</span>
          </div>
        ))}
      </div>

      {showDetail && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-800">Réception — {selected.fournisseurs?.nom}</h3>
              <button onClick={() => setShowDetail(false)}><X size={20} className="text-gray-400" /></button>
            </div>

            <div className="mb-6">
              <label className="text-xs font-medium text-gray-500 mb-1 block">Date de réception</label>
              <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={dateReception} onChange={e => setDateReception(e.target.value)} />
            </div>

            <div className="mb-6">
              <label className="text-xs font-medium text-gray-500 mb-1 block">Facture liée</label>
              <div className="flex gap-2">
                <select className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" value={factureSelectionnee?.id || ''} onChange={e => setFactureSelectionnee(factures.find(f => f.id === e.target.value) || null)}>
                  <option value="">Aucune facture sélectionnée</option>
                  {factures.map(f => (
                    <option key={f.id} value={f.id}>{f.numero || 'N° non extrait'} — {f.montant_total_ht}€ HT</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 cursor-pointer whitespace-nowrap">
                  {uploadingFacture ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
                  Importer
                  <input type="file" accept=".pdf" className="hidden" disabled={uploadingFacture} onChange={e => e.target.files[0] && importerFactureDepuisReception(e.target.files[0])} />
                </label>
              </div>
            </div>

            <div className="space-y-2 mb-6">
              {lignes.map(l => {
                const ecart = (l.quantite_commandee || 0) - (l.quantite_receptionnee || 0)
                return (
                  <div key={l.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                    <div className="flex-1">
                      <p className="font-medium text-gray-700">{l.matieres_premieres_fournisseurs?.matieres_premieres?.designation_interne}</p>
                      <p className="text-xs text-gray-400">Commandé : {l.quantite_commandee}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <input
                        type="number"
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right"
                        value={l.quantite_receptionnee}
                        onChange={e => updateQuantiteReceptionnee(l.id, parseFloat(e.target.value) || 0)}
                      />
                      {ecart !== 0 && (
                        <span className="text-xs text-orange-500 font-medium w-16 text-right">Écart {ecart > 0 ? '-' : '+'}{Math.abs(ecart)}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {ecarts && Math.abs(ecarts.ecartMontant) > 0.5 && (
              <div className="flex items-center gap-2 bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mb-4">
                <AlertTriangle size={16} />
                Écart de montant détecté : {ecarts.ecartMontant > 0 ? '+' : ''}{ecarts.ecartMontant.toFixed(2)}€ par rapport à la facture
              </div>
            )}

            <div className="border-t border-gray-100 pt-4 space-y-1 mb-6">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Montant attendu (réception)</span>
                <span className="font-medium text-gray-800">{ecarts?.montantAttendu.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Montant facturé</span>
                <span className="font-medium text-gray-800">{ecarts?.montantFacture.toFixed(2)}€</span>
              </div>
            </div>

            <button onClick={validerReception} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
              <Check size={16} /> Valider la réception
            </button>
          </div>
        </div>
      )}
    </div>
  )
}