import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Upload, FileText, Eye, X, Check, AlertCircle, Loader } from 'lucide-react'
import { extractInvoiceData } from '../lib/ocr'

const STATUT_CONFIG = {
  en_cours: { label: 'En cours de traitement', color: 'bg-blue-50 text-blue-500', icon: Loader },
  a_verifier: { label: 'À vérifier', color: 'bg-orange-50 text-orange-500', icon: AlertCircle },
  validee: { label: 'Validée', color: 'bg-green-50 text-green-600', icon: Check }
}

export default function Factures() {
  const [factures, setFactures] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [extracted, setExtracted] = useState(null)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showStockUpdate, setShowStockUpdate] = useState(false)
  const [stockAMettreAJour, setStockAMettreAJour] = useState([])
  const [isValidating, setIsValidating] = useState(false)
  const [isUpdatingStock, setIsUpdatingStock] = useState(false)
  const [totalLignesExtraites, setTotalLignesExtraites] = useState(0)

  useEffect(() => { fetchFactures() }, [])

  async function fetchFactures() {
    const { data } = await supabase
      .from('factures')
      .select('*, fournisseurs(nom)')
      .order('created_at', { ascending: false })
    setFactures(data || [])
    setLoading(false)
  }

  async function handleFiles(files) {
    const pdfs = Array.from(files).filter(f => f.type === 'application/pdf')
    if (pdfs.length === 0) return alert('Veuillez importer des fichiers PDF uniquement.')
    setUploading(true)
    for (const file of pdfs) {
      await processFile(file)
    }
    setUploading(false)
    fetchFactures()
  }

  async function processFile(file) {
    const base64 = await fileToBase64(file)
    const { data: factureInserted } = await supabase
      .from('factures')
      .insert({ statut: 'en_cours', fichier_url: base64 })
      .select()
      .single()

    try {
      const { extracted, needsReview, confidence } = await extractInvoiceData(base64)
      let fournisseurId = null

      if (extracted.fournisseur?.nom) {
        const { data: existing } = await supabase
          .from('fournisseurs')
          .select('*')
          .ilike('nom', extracted.fournisseur.nom)
          .single()

        if (existing) {
          fournisseurId = existing.id
          const completion = {}
          if (!existing.adresse && extracted.fournisseur.adresse) completion.adresse = extracted.fournisseur.adresse
          if (!existing.telephone && extracted.fournisseur.telephone) completion.telephone = extracted.fournisseur.telephone
          if (!existing.email && extracted.fournisseur.email) completion.email = extracted.fournisseur.email
          if (!existing.siret && extracted.fournisseur.siret) completion.siret = extracted.fournisseur.siret
          if (!existing.siren && extracted.fournisseur.siren) completion.siren = extracted.fournisseur.siren
          if (Object.keys(completion).length > 0) {
            await supabase.from('fournisseurs').update(completion).eq('id', existing.id)
          }
        } else {
          const { data: newF } = await supabase
            .from('fournisseurs')
            .insert({ ...extracted.fournisseur, etat: 'actif' })
            .select()
            .single()
          fournisseurId = newF.id
        }
      }

      function normalizeDate(dateStr) {
        if (!dateStr) return null
        const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/)
        if (match) return `${match[3]}-${match[2]}-${match[1]}`
        const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
        if (isoMatch) return dateStr
        return null
      }

      const delaiPaiement = extracted.facture?.delai_paiement_jours || 0
      const dateFacture = normalizeDate(extracted.facture?.date)

      if (fournisseurId && delaiPaiement > 0) {
        await supabase.from('fournisseurs').update({ delai_paiement: delaiPaiement }).eq('id', fournisseurId)
      }

      if (dateFacture && delaiPaiement > 0) {
        const dateEcheance = new Date(dateFacture)
        dateEcheance.setDate(dateEcheance.getDate() + delaiPaiement)
        const dateAlerteJ7 = new Date(dateEcheance)
        dateAlerteJ7.setDate(dateAlerteJ7.getDate() - 7)
        const aujourdhui = new Date()
        const joursAvantAlerte = Math.ceil((dateAlerteJ7 - aujourdhui) / (1000 * 60 * 60 * 24))

        if (joursAvantAlerte <= 0) {
          await supabase.from('alertes').insert({
            type: 'retard_paiement',
            message: `Paiement dû dans moins de 7 jours pour la facture ${extracted.facture?.numero || ''} — échéance le ${dateEcheance.toLocaleDateString('fr-FR')}`,
            reference_id: fournisseurId,
            reference_table: 'fournisseurs'
          })
        }
      }

      await supabase.from('factures').update({
        fournisseur_id: fournisseurId,
        numero: extracted.facture?.numero,
        date_facture: dateFacture,
        montant_total_ht: extracted.facture?.montant_total_ht,
        montant_total_ttc: extracted.facture?.montant_total_ttc,
        lignes_extraites: JSON.stringify(extracted.lignes || []),
        statut: 'a_verifier',
        extraction_incomplete: needsReview,
        confiance_ocr: confidence
      }).eq('id', factureInserted.id)

    } catch (e) {
      await supabase.from('factures').update({
        statut: 'a_verifier',
        extraction_incomplete: true,
        confiance_ocr: 0
      }).eq('id', factureInserted.id)
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function openDetail(facture) {
    setSelected(facture)
    setPdfUrl(facture.fichier_url ? `data:application/pdf;base64,${facture.fichier_url}` : null)
    setExtracted({
      nom_fournisseur: facture.fournisseurs?.nom || '',
      numero: facture.numero || '',
      date_facture: facture.date_facture || '',
      montant_total_ht: facture.montant_total_ht || '',
      montant_total_ttc: facture.montant_total_ttc || ''
    })
    setShowDetail(true)
  }

  async function ventilerVersMercuriale(factureId, fournisseurId) {
    const { data: facture } = await supabase.from('factures').select('lignes_extraites').eq('id', factureId).single()
    if (!facture?.lignes_extraites) return

    let lignes = []
    try { lignes = JSON.parse(facture.lignes_extraites) } catch { return }

    for (const ligne of lignes) {
      if (!ligne.designation) continue

      const { data: lienExistant } = await supabase
        .from('matieres_premieres_fournisseurs')
        .select('id, prix_actuel, matiere_premiere_id')
        .eq('fournisseur_id', fournisseurId)
        .ilike('designation_fournisseur', ligne.designation)
        .maybeSingle()

      const prixUnitaire = parseFloat(ligne.prix_unitaire_ht) || 0
      const conditionnement = parseFloat(ligne.conditionnement) || 1
      function getPrixBase(prix, conditionnement, unite) {
          const u = (unite || '').toLowerCase().trim()
          console.log('getPrixBase:', prix, conditionnement, unite, u)
          if (u === 'kg') return prix / (conditionnement * 1000)
          if (u === 'l') return prix / (conditionnement * 1000)
          if (u === 'g' || u === 'ml') return prix / conditionnement
          return prix / conditionnement
        }
        const prixGUML = getPrixBase(prixUnitaire, conditionnement, ligne.unite)

      if (lienExistant) {
        if (Math.abs((lienExistant.prix_actuel || 0) - prixUnitaire) > 0.01) {
          await supabase.from('matieres_premieres_fournisseurs').update({
            nouveau_prix: prixUnitaire,
            prix_actuel: prixUnitaire,
            prix_g_u_ml: prixGUML
          }).eq('id', lienExistant.id)

          await supabase.from('alertes').insert({
            type: 'ecart_prix',
            message: `Changement de prix détecté pour ${ligne.designation} : ${lienExistant.prix_actuel}€ → ${prixUnitaire}€`,
            reference_id: lienExistant.matiere_premiere_id,
            reference_table: 'matieres_premieres'
          })
        }
      } else {
        const { data: nouvelleMp } = await supabase
          .from('matieres_premieres')
          .insert({
            designation_interne: ligne.designation,
            unite: ligne.unite || 'kg',
            stock_mini: 0,
            seuil_rouge: 3,
            seuil_orange: 7
          })
          .select()
          .single()

        await supabase.from('matieres_premieres_fournisseurs').insert({
          matiere_premiere_id: nouvelleMp.id,
          fournisseur_id: fournisseurId,
          reference_fournisseur: ligne.reference,
          designation_fournisseur: ligne.designation,
          conditionnement: conditionnement,
          unite: ligne.unite,
          prix_actuel: prixUnitaire,
          prix_initial: prixUnitaire,
          prix_g_u_ml: prixGUML
        })

        await supabase.from('alertes').insert({
          type: 'rupture_stock',
          message: `Nouvel article détecté sur facture : "${ligne.designation}" — vérifiez et complétez la fiche dans la mercuriale`,
          reference_id: nouvelleMp.id,
          reference_table: 'matieres_premieres'
        })
      }
    }
  }

  async function validerFacture() {
    if (isValidating) return
    if (selected.statut === 'validee') {
      alert('Cette facture a déjà été validée et ne peut pas être validée à nouveau.')
      setShowDetail(false)
      return
    }

    setIsValidating(true)
    try {
      await supabase.from('factures').update({
        numero: extracted.numero,
        date_facture: extracted.date_facture || null,
        montant_total_ht: extracted.montant_total_ht,
        montant_total_ttc: extracted.montant_total_ttc,
        statut: 'validee'
      }).eq('id', selected.id)

      if (selected.fournisseur_id) {
        await ventilerVersMercuriale(selected.id, selected.fournisseur_id)
        await preparerMiseAJourStock(selected.id, selected.fournisseur_id)
      }

      setShowDetail(false)
      fetchFactures()
    } finally {
      setIsValidating(false)
    }
  }

  async function preparerMiseAJourStock(factureId, fournisseurId) {
    const { data: facture } = await supabase.from('factures').select('lignes_extraites').eq('id', factureId).single()
    if (!facture?.lignes_extraites) return
    let lignesFacture = []
    try { lignesFacture = JSON.parse(facture.lignes_extraites) } catch { return }

    const lignesAvecDesignation = lignesFacture.filter(l => l.designation)
    setTotalLignesExtraites(lignesAvecDesignation.length)

    const parMatierePremiere = new Map()
    for (const ligne of lignesAvecDesignation) {
      if (!ligne.designation) continue
      const { data: lien } = await supabase
        .from('matieres_premieres_fournisseurs')
        .select('id, matiere_premiere_id, conditionnement, matieres_premieres(designation_interne, unite)')
        .eq('fournisseur_id', fournisseurId)
        .ilike('designation_fournisseur', ligne.designation)
        .maybeSingle()

      if (lien) {
        // Une même matière première peut apparaître sur plusieurs lignes de facture (ex: plusieurs
        // pièces d'un produit vendu au poids, pesées séparément) : on additionne les quantités
        // plutôt que d'écraser, pour ne pas perdre de marchandise et afficher une seule ligne.
        const quantiteAjoutee = Math.round((parseFloat(ligne.quantite) || 0) * (lien.conditionnement || 1) * 100) / 100
        if (parMatierePremiere.has(lien.matiere_premiere_id)) {
          const existant = parMatierePremiere.get(lien.matiere_premiere_id)
          existant.quantiteEnUnite = Math.round((existant.quantiteEnUnite + quantiteAjoutee) * 100) / 100
        } else {
          parMatierePremiere.set(lien.matiere_premiere_id, {
            matiere_premiere_id: lien.matiere_premiere_id,
            designation: lien.matieres_premieres?.designation_interne,
            unite: lien.matieres_premieres?.unite,
            conditionnement: lien.conditionnement || 1,
            quantiteEnUnite: quantiteAjoutee
          })
        }
      }
    }
    const stockUpdates = Array.from(parMatierePremiere.values())
    if (stockUpdates.length > 0) {
      setStockAMettreAJour(stockUpdates)
      setShowStockUpdate(true)
    }
  }

  async function confirmerMiseAJourStock() {
    if (isUpdatingStock) return
    setIsUpdatingStock(true)
    try {
      for (const item of stockAMettreAJour) {
        const { data: mp } = await supabase.from('matieres_premieres').select('quantite_stock').eq('id', item.matiere_premiere_id).single()
        const nouveauStock = (mp?.quantite_stock || 0) + item.quantiteEnUnite
        await supabase.from('matieres_premieres').update({ quantite_stock: nouveauStock }).eq('id', item.matiere_premiere_id)
        await supabase.from('mouvements_stock').insert({
          matiere_premiere_id: item.matiere_premiere_id,
          type: 'reception',
          quantite: item.quantiteEnUnite,
          raison: 'Facture sans commande associée'
        })
      }
      setShowStockUpdate(false)
      setStockAMettreAJour([])
    } finally {
      setIsUpdatingStock(false)
    }
  }

async function deleteFacture() {
  if (!window.confirm('Supprimer définitivement cette facture ?')) return
  await supabase.from('factures').delete().eq('id', selected.id)
  setShowDetail(false)
  fetchFactures()
}

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Corbeille factures</h2>
      </div>

      {/* Zone de dépôt */}
      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center mb-8 transition-colors ${dragOver ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader size={32} className="text-yellow-400 animate-spin" />
            <p className="text-sm text-gray-500">Traitement en cours...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload size={32} className="text-gray-300" />
            <p className="text-sm text-gray-500">Glissez vos factures PDF ici</p>
            <p className="text-xs text-gray-400">ou</p>
            <label className="cursor-pointer px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
              Parcourir
              <input type="file" accept=".pdf" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
            </label>
          </div>
        )}
      </div>

      {/* Liste des factures */}
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Factures déposées</h3>
      {loading ? <p className="text-gray-400">Chargement...</p> : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {factures.length === 0 && (
            <p className="p-6 text-gray-400 text-sm">Aucune facture déposée.</p>
          )}
          {factures.map(f => {
            const config = STATUT_CONFIG[f.statut]
            const Icon = config.icon
            return (
              <div key={f.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50">
                <div className="flex items-center gap-4">
                  <FileText size={20} className="text-gray-300" />
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{f.fournisseurs?.nom || 'Fournisseur inconnu'}</p>
                    <p className="text-xs text-gray-400">{f.numero || 'N° non extrait'} {f.date_facture ? `— ${f.date_facture}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${config.color}`}>
                    <Icon size={12} />
                    {config.label}
                  </span>
                  <button onClick={() => openDetail(f)} className="p-1.5 hover:bg-gray-100 rounded-lg">
  <Eye size={16} className="text-gray-400" />
</button>
<button onClick={async () => {
  if (!window.confirm('Supprimer définitivement cette facture ?')) return
  await supabase.from('factures').delete().eq('id', f.id)
  fetchFactures()
}} className="p-1.5 hover:bg-gray-100 rounded-lg">
  <X size={16} className="text-red-400" />
</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal détail */}
      {showDetail && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-800">Vérification de la facture</h3>
              <button onClick={() => setShowDetail(false)}><X size={20} className="text-gray-400" /></button>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* PDF viewer */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Document original</p>
                {pdfUrl ? (
                  <iframe src={pdfUrl} className="w-full h-96 rounded-lg border border-gray-200" />
                ) : (
                  <div className="w-full h-96 rounded-lg border border-gray-200 flex items-center justify-center text-gray-300 text-sm">PDF non disponible</div>
                )}
              </div>

              {/* Formulaire correction */}
              <div className="space-y-4">
                <p className="text-xs font-medium text-gray-500">Données extraites — vérifiez et corrigez si nécessaire</p>
                {[
                  { label: 'Fournisseur', key: 'nom_fournisseur' },
                  { label: 'N° facture', key: 'numero' },
                  { label: 'Date facture', key: 'date_facture', type: 'date' },
                  { label: 'Montant HT (€)', key: 'montant_total_ht', type: 'number' },
                  { label: 'Montant TTC (€)', key: 'montant_total_ttc', type: 'number' },
                ].map(({ label, key, type }) => (
                  <div key={key}>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>
                    <input
                      type={type || 'text'}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
                      value={extracted[key] || ''}
                      onChange={e => setExtracted({ ...extracted, [key]: e.target.value })}
                    />
                  </div>
                ))}

                <div className="flex gap-3 mt-4">
  <button onClick={deleteFacture} disabled={isValidating} className="px-4 py-2.5 rounded-lg text-red-500 text-sm font-medium hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed">
    Supprimer
  </button>
  {selected.statut !== 'validee' && (
    <button
      onClick={validerFacture}
      disabled={isValidating}
      className="flex-1 py-2.5 rounded-lg text-white text-sm font-medium cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      style={{ backgroundColor: '#C9A84C' }}
    >
      {isValidating && <Loader size={16} className="animate-spin" />}
      {isValidating ? 'Validation en cours...' : 'Valider la facture'}
    </button>
  )}
</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showStockUpdate && (
        <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center py-8 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Mettre à jour le stock ?</h3>
            <p className="text-sm text-gray-500 mb-3">Cette facture ne correspond à aucune commande passée dans Orpailleur. Voulez-vous ajouter ces quantités au stock de la mercuriale ?</p>
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-4">
              <AlertCircle size={14} className="text-gray-400 shrink-0" />
              <span>
                {totalLignesExtraites} ligne(s) produit détectée(s) sur la facture — {stockAMettreAJour.length} associée(s) à un article existant de la mercuriale.
                {totalLignesExtraites !== stockAMettreAJour.length && " Vérifie qu'aucun article n'est manquant."}
              </span>
            </div>
            <div className="space-y-2 mb-6">
              {stockAMettreAJour.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                  <span className="font-medium text-gray-700">{item.designation}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right"
                      value={item.quantiteEnUnite}
                      onChange={e => setStockAMettreAJour(stockAMettreAJour.map((s, j) => j === i ? { ...s, quantiteEnUnite: parseFloat(e.target.value) || 0 } : s))}
                    />
                    <span className="text-gray-500 text-xs">{item.unite}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowStockUpdate(false); setStockAMettreAJour([]) }} disabled={isUpdatingStock} className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed">
                Ignorer
              </button>
              <button
                onClick={confirmerMiseAJourStock}
                disabled={isUpdatingStock}
                className="flex-1 py-2.5 rounded-lg text-white text-sm font-medium cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: '#C9A84C' }}
              >
                {isUpdatingStock && <Loader size={16} className="animate-spin" />}
                {isUpdatingStock ? 'Mise à jour en cours...' : 'Mettre à jour le stock'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}