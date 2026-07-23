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
  const [designationsNonAssociees, setDesignationsNonAssociees] = useState([])
  const [uploadProgress, setUploadProgress] = useState(null)
  const [confirmationDoublon, setConfirmationDoublon] = useState(null)

  useEffect(() => { fetchFactures() }, [])

  async function fetchFactures() {
    const { data } = await supabase
      .from('factures')
      .select('*, fournisseurs(nom)')
      .order('created_at', { ascending: false })
    setFactures(data || [])
    setLoading(false)
  }

  function demanderConfirmationDoublon(numero, fileName) {
    return new Promise(resolve => {
      setConfirmationDoublon({ numero, fileName, resolve })
    })
  }

  async function handleFiles(files) {
    const pdfs = Array.from(files).filter(f => f.type === 'application/pdf')
    if (pdfs.length === 0) return alert('Veuillez importer des fichiers PDF uniquement.')
    setUploading(true)
    setUploadProgress({ total: pdfs.length, done: 0, startedAt: Date.now() })
    const echecs = []
    const doublons = []
    for (const file of pdfs) {
      try {
        const result = await processFile(file)
        if (result?.doublon) doublons.push(`${file.name} (n° ${result.numero})`)
      } catch (e) {
        console.error(`Échec du traitement de "${file.name}":`, e)
        echecs.push(file.name)
      }
      setUploadProgress(prev => prev ? { ...prev, done: prev.done + 1 } : prev)
    }
    setUploading(false)
    setUploadProgress(null)
    fetchFactures()
    if (doublons.length > 0) {
      alert(`${doublons.length} facture(s) non importée(s) car déjà enregistrée(s) pour ce fournisseur avec le même numéro : ${doublons.join(', ')}.`)
    }
    if (echecs.length > 0) {
      alert(`${echecs.length} facture(s) n'ont pas pu être importée(s) : ${echecs.join(', ')}. Les autres ont bien été traitées, tu peux réessayer celles-ci individuellement.`)
    }
  }

  async function processFile(file) {
    const base64 = await fileToBase64(file)
    const { data: factureInserted } = await supabase
      .from('factures')
      .insert({ statut: 'en_cours', fichier_url: base64 })
      .select()
      .single()

    try {
      const { extracted, needsReview, confidence, rawText } = await extractInvoiceData(base64)
      let fournisseurId = null

      if (extracted.fournisseur?.nom) {
        const { data: existing } = await supabase
          .from('fournisseurs')
          .select('*')
          .ilike('nom', extracted.fournisseur.nom)
          .maybeSingle()

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

      // Détection de doublon : même numéro de facture pour le même fournisseur = probablement déjà
      // importée. Exception automatique : si le document mentionne "reliquat" (livraison
      // complémentaire d'une commande déjà partiellement livrée), il est normal que le même numéro
      // revienne, donc on importe directement sans interrompre. Dans les autres cas, on laisse
      // l'utilisateur décider via une confirmation plutôt que de bloquer silencieusement.
      if (extracted.facture?.numero && fournisseurId) {
        const { data: existantes } = await supabase
          .from('factures')
          .select('id')
          .eq('fournisseur_id', fournisseurId)
          .eq('numero', extracted.facture.numero)
          .neq('id', factureInserted.id)

        const contientReliquat = /reliquat/i.test(rawText || '') || /reliquat/i.test(extracted.facture?.numero || '')

        if (existantes && existantes.length > 0 && !contientReliquat) {
          const importerQuandMeme = await demanderConfirmationDoublon(extracted.facture.numero, file.name)
          if (!importerQuandMeme) {
            await supabase.from('factures').delete().eq('id', factureInserted.id)
            return { doublon: true, numero: extracted.facture.numero }
          }
        }
      }

      function normalizeDate(dateStr) {
        if (!dateStr) return null
        const s = dateStr.trim()
        // Format ISO déjà normalisé : YYYY-MM-DD
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (m) return `${m[1]}-${m[2]}-${m[3]}`
        // DD/MM/YYYY ou DD-MM-YYYY (année sur 4 chiffres, slash OU tiret)
        m = s.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/)
        if (m) return `${m[3]}-${m[2]}-${m[1]}`
        // DD/MM/YY ou DD-MM-YY (année sur 2 chiffres, slash OU tiret)
        m = s.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{2})$/)
        if (m) {
          const anneeCourte = parseInt(m[3], 10)
          const anneeComplete = anneeCourte < 70 ? 2000 + anneeCourte : 1900 + anneeCourte
          return `${anneeComplete}-${m[2]}-${m[1]}`
        }
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

  async function rattraperStock(facture) {
    setSelected(facture)
    await preparerMiseAJourStock(facture.id, facture.fournisseur_id)
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
    if (!facture?.lignes_extraites) return []

    let lignes = []
    try { lignes = JSON.parse(facture.lignes_extraites) } catch { return [] }

    const echecs = []
    const nouveaux = []

    for (const ligne of lignes) {
      if (!ligne.designation) continue

      const { data: lienExistant, error: errLookup } = await supabase
        .from('matieres_premieres_fournisseurs')
        .select('id, prix_actuel, matiere_premiere_id, conditionnement, unite')
        .eq('fournisseur_id', fournisseurId)
        .ilike('designation_fournisseur', ligne.designation)
        .maybeSingle()

      if (errLookup) {
        console.error(`Ventilation mercuriale — échec de recherche pour "${ligne.designation}":`, errLookup)
        echecs.push(ligne.designation)
        continue
      }

      const prixUnitaire = parseFloat(ligne.prix_unitaire_ht) || 0
      const conditionnement = parseFloat(ligne.conditionnement) || 1
      function getPrixBase(prix, conditionnement, unite) {
          const u = (unite || '').toLowerCase().trim()
          if (u === 'kg') return prix / (conditionnement * 1000)
          if (u === 'l') return prix / (conditionnement * 1000)
          if (u === 'g' || u === 'ml') return prix / conditionnement
          return prix / conditionnement
        }
        const prixGUML = getPrixBase(prixUnitaire, conditionnement, ligne.unite)

      if (lienExistant) {
        // Une fois un article créé, on ne réécrit jamais silencieusement son conditionnement/unité
        // (une correction manuelle faite par le boulanger doit rester stable). Mais si la nouvelle
        // lecture de facture diffère nettement de ce qui est enregistré, on le signale par une
        // alerte plutôt que de laisser une éventuelle erreur ancienne perdurer sans que personne
        // ne le sache.
        const conditionnementLien = parseFloat(lienExistant.conditionnement) || 1
        if (conditionnement > 0 && Math.abs(conditionnementLien - conditionnement) / conditionnement > 0.1) {
          await supabase.from('alertes').insert({
            type: 'ecart_prix',
            message: `Conditionnement différent détecté pour "${ligne.designation}" : mercuriale=${conditionnementLien}${lienExistant.unite || ''}, nouvelle lecture=${conditionnement}${ligne.unite || ''}. Vérifie la fiche article.`,
            reference_id: lienExistant.matiere_premiere_id,
            reference_table: 'matieres_premieres'
          })
        }

        if (Math.abs((lienExistant.prix_actuel || 0) - prixUnitaire) > 0.01) {
          const { error: errUpdate } = await supabase.from('matieres_premieres_fournisseurs').update({
            nouveau_prix: prixUnitaire,
            prix_actuel: prixUnitaire,
            prix_g_u_ml: prixGUML
          }).eq('id', lienExistant.id)

          if (errUpdate) {
            console.error(`Ventilation mercuriale — échec de mise à jour du prix pour "${ligne.designation}":`, errUpdate)
            echecs.push(ligne.designation)
            continue
          }

          await supabase.from('alertes').insert({
            type: 'ecart_prix',
            message: `Changement de prix détecté pour ${ligne.designation} : ${lienExistant.prix_actuel}€ → ${prixUnitaire}€`,
            reference_id: lienExistant.matiere_premiere_id,
            reference_table: 'matieres_premieres'
          })
        }
      } else {
        const { data: nouvelleMp, error: errInsertMp } = await supabase
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

        if (errInsertMp || !nouvelleMp) {
          console.error(`Ventilation mercuriale — échec de création de l'article "${ligne.designation}":`, errInsertMp)
          echecs.push(ligne.designation)
          continue
        }

        const { error: errInsertLien } = await supabase.from('matieres_premieres_fournisseurs').insert({
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

        if (errInsertLien) {
          console.error(`Ventilation mercuriale — échec de liaison fournisseur pour "${ligne.designation}":`, errInsertLien)
          echecs.push(ligne.designation)
          continue
        }

        nouveaux.push(ligne.designation)

        await supabase.from('alertes').insert({
          type: 'rupture_stock',
          message: `Nouvel article détecté sur facture : "${ligne.designation}" — vérifiez et complétez la fiche dans la mercuriale`,
          reference_id: nouvelleMp.id,
          reference_table: 'matieres_premieres'
        })
      }
    }
    return { echecs, nouveaux }
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
        const { echecs: echecsVentilation, nouveaux } = await ventilerVersMercuriale(selected.id, selected.fournisseur_id)
        await preparerMiseAJourStock(selected.id, selected.fournisseur_id, nouveaux)
        if (echecsVentilation && echecsVentilation.length > 0) {
          alert(`Attention : ${echecsVentilation.length} article(s) n'ont pas pu être ajoutés à la mercuriale (erreur technique) : ${echecsVentilation.join(', ')}. Vérifie la console ou réessaie de valider cette facture.`)
        }
      }

      setShowDetail(false)
      fetchFactures()
    } finally {
      setIsValidating(false)
    }
  }

  async function preparerMiseAJourStock(factureId, fournisseurId, nouveaux = []) {
    const { data: facture } = await supabase.from('factures').select('lignes_extraites').eq('id', factureId).single()
    if (!facture?.lignes_extraites) return
    let lignesFacture = []
    try { lignesFacture = JSON.parse(facture.lignes_extraites) } catch { return }

    const lignesAvecDesignation = lignesFacture.filter(l => l.designation)
    setTotalLignesExtraites(lignesAvecDesignation.length)

    const parMatierePremiere = new Map()
    const nonAssociees = []
    for (const ligne of lignesAvecDesignation) {
      if (!ligne.designation) continue
      const { data: lien, error: errLien } = await supabase
        .from('matieres_premieres_fournisseurs')
        .select('id, matiere_premiere_id, conditionnement, matieres_premieres(designation_interne, unite)')
        .eq('fournisseur_id', fournisseurId)
        .ilike('designation_fournisseur', ligne.designation)
        .maybeSingle()

      if (errLien) console.error(`Recherche article échouée pour "${ligne.designation}":`, errLien)

      if (lien) {
        // Une même matière première peut apparaître sur plusieurs lignes de facture (ex: plusieurs
        // pièces d'un produit vendu au poids, pesées séparément) : on additionne les quantités
        // plutôt que d'écraser, pour ne pas perdre de marchandise et afficher une seule ligne.
        const quantiteAjoutee = Math.round((parseFloat(ligne.quantite) || 0) * (lien.conditionnement || 1) * 100) / 100
        const estNouveau = (nouveaux || []).includes(ligne.designation)
        if (parMatierePremiere.has(lien.matiere_premiere_id)) {
          const existant = parMatierePremiere.get(lien.matiere_premiere_id)
          existant.quantiteEnUnite = Math.round((existant.quantiteEnUnite + quantiteAjoutee) * 100) / 100
          existant.quantiteBrute = (existant.quantiteBrute || 0) + (parseFloat(ligne.quantite) || 0)
        } else {
          parMatierePremiere.set(lien.matiere_premiere_id, {
            matiere_premiere_fournisseur_id: lien.id,
            matiere_premiere_id: lien.matiere_premiere_id,
            designation: lien.matieres_premieres?.designation_interne,
            unite: lien.matieres_premieres?.unite,
            uniteOriginale: lien.matieres_premieres?.unite,
            conditionnement: lien.conditionnement || 1,
            quantiteEnUnite: quantiteAjoutee,
            quantiteBrute: parseFloat(ligne.quantite) || 0,
            estNouveau
          })
        }
      } else {
        nonAssociees.push(ligne.designation)
      }
    }
    setDesignationsNonAssociees(nonAssociees)
    const stockUpdates = Array.from(parMatierePremiere.values())
    if (stockUpdates.length > 0 || nonAssociees.length > 0) {
      setStockAMettreAJour(stockUpdates)
      setShowStockUpdate(true)
    }
  }

  async function confirmerMiseAJourStock() {
    if (isUpdatingStock) return
    setIsUpdatingStock(true)
    try {
      for (const item of stockAMettreAJour) {
        // Si la quantité ou l'unité ont été corrigées manuellement (nouveau produit ou déjà connu),
        // on réécrit conditionnement/unité dans le catalogue : la correction faite maintenant, une
        // seule fois, doit rester valable pour toutes les prochaines factures de ce même produit.
        if (item.matiere_premiere_fournisseur_id && item.quantiteBrute > 0) {
          const conditionnementCorrige = Math.round((item.quantiteEnUnite / item.quantiteBrute) * 1000) / 1000
          const uniteChangee = item.uniteOriginale && item.unite !== item.uniteOriginale
          const conditionnementChange = Math.abs(conditionnementCorrige - item.conditionnement) > 0.001
          if (conditionnementChange) {
            await supabase.from('matieres_premieres_fournisseurs')
              .update({ conditionnement: conditionnementCorrige })
              .eq('id', item.matiere_premiere_fournisseur_id)
          }
          if (uniteChangee) {
            await supabase.from('matieres_premieres').update({ unite: item.unite }).eq('id', item.matiere_premiere_id)
          }
        }

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
      if (selected?.id) {
        await supabase.from('factures').update({ stock_applique: true }).eq('id', selected.id)
      }
      setShowStockUpdate(false)
      setStockAMettreAJour([])
      fetchFactures()
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
            <p className="text-sm text-gray-500">
              Traitement en cours... {uploadProgress && `(${uploadProgress.done}/${uploadProgress.total})`}
            </p>
            {uploadProgress && uploadProgress.done > 0 && (() => {
              const ecouleMs = Date.now() - uploadProgress.startedAt
              const msParFacture = ecouleMs / uploadProgress.done
              const restantes = uploadProgress.total - uploadProgress.done
              const estimationMin = Math.max(1, Math.round((msParFacture * restantes) / 60000))
              return restantes > 0 ? (
                <p className="text-xs text-gray-400">≈ {estimationMin} min restante{estimationMin > 1 ? 's' : ''}</p>
              ) : null
            })()}
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
                  {f.statut === 'validee' && !f.stock_applique && f.fournisseur_id && (
                    <button
                      onClick={() => rattraperStock(f)}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium bg-orange-50 text-orange-600 hover:bg-orange-100 cursor-pointer"
                      title="Le stock de cette facture n'a jamais été appliqué à la mercuriale"
                    >
                      <AlertCircle size={12} />
                      Stock non appliqué
                    </button>
                  )}
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
              </span>
            </div>
            {designationsNonAssociees.length > 0 && (
              <div className="flex items-start gap-2 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
                <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                <span>
                  {designationsNonAssociees.length} article(s) détecté(s) mais non ajouté(s) à la mercuriale (probable erreur technique, voir la console) : {designationsNonAssociees.join(', ')}
                </span>
              </div>
            )}
            {(() => {
              const nouveaux = stockAMettreAJour.filter(i => i.estNouveau)
              const connus = stockAMettreAJour.filter(i => !i.estNouveau)
              const renderLigne = (item, i, listeSource) => (
                <div key={item.matiere_premiere_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                  <span className="font-medium text-gray-700">{item.designation}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right"
                      value={item.quantiteEnUnite}
                      onChange={e => setStockAMettreAJour(stockAMettreAJour.map(s => s.matiere_premiere_id === item.matiere_premiere_id ? { ...s, quantiteEnUnite: parseFloat(e.target.value) || 0 } : s))}
                    />
                    <select
                      className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-gray-600 bg-white cursor-pointer"
                      value={item.unite}
                      onChange={e => setStockAMettreAJour(stockAMettreAJour.map(s => s.matiere_premiere_id === item.matiere_premiere_id ? { ...s, unite: e.target.value } : s))}
                    >
                      <option value="kg">kg</option>
                      <option value="L">L</option>
                      <option value="piece">piece</option>
                    </select>
                    <button
                      onClick={() => setStockAMettreAJour(stockAMettreAJour.filter(s => s.matiere_premiere_id !== item.matiere_premiere_id))}
                      title="Retirer cette ligne (comptée en trop ou en double)"
                      className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )
              return (
                <>
                  {nouveaux.length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                        <AlertCircle size={14} className="shrink-0" />
                        <span>{nouveaux.length} nouveau(x) produit(s) — vérifie la quantité une fois, elle restera la référence pour toutes les prochaines factures de ce produit</span>
                      </div>
                      <div className="space-y-2">
                        {nouveaux.map((item, i) => renderLigne(item, i, nouveaux))}
                      </div>
                    </div>
                  )}
                  {connus.length > 0 && (
                    <details className="mb-6">
                      <summary className="cursor-pointer text-xs font-medium text-gray-500 mb-2">
                        {connus.length} produit(s) déjà connu(s) — appliqué(s) automatiquement (cliquer pour vérifier)
                      </summary>
                      <div className="space-y-2 mt-2">
                        {connus.map((item, i) => renderLigne(item, i, connus))}
                      </div>
                    </details>
                  )}
                  {nouveaux.length === 0 && <div className="mb-6" />}
                </>
              )
            })()}
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

      {confirmationDoublon && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle size={22} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-bold text-gray-800 mb-1">Facture déjà importée ?</h3>
                <p className="text-sm text-gray-500">
                  Une facture avec le numéro <span className="font-semibold text-gray-700">{confirmationDoublon.numero}</span> existe déjà pour ce fournisseur ("{confirmationDoublon.fileName}"). Veux-tu quand même importer ce document (par exemple s'il s'agit d'un reliquat) ?
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { confirmationDoublon.resolve(false); setConfirmationDoublon(null) }}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 cursor-pointer"
              >
                Ne pas importer
              </button>
              <button
                onClick={() => { confirmationDoublon.resolve(true); setConfirmationDoublon(null) }}
                className="flex-1 py-2.5 rounded-lg text-white text-sm font-medium cursor-pointer hover:opacity-90"
                style={{ backgroundColor: '#C9A84C' }}
              >
                Importer quand même
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}