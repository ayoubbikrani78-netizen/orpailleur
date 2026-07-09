import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, ChevronRight, X, Send, Mail, FileDown, AlertTriangle } from 'lucide-react'

const STATUT_CONFIG = {
  brouillon: { label: 'Brouillon', color: 'bg-gray-100 text-gray-700' },
  envoyee: { label: 'Envoyée', color: 'bg-blue-50 text-blue-500' },
  receptionnee: { label: 'Réceptionnée', color: 'bg-green-50 text-green-600' }
}

export default function Commandes() {
  const [commandes, setCommandes] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [showNewFournisseur, setShowNewFournisseur] = useState(false)
  const [nouveauFournisseurNom, setNouveauFournisseurNom] = useState('')
  const [reglages, setReglages] = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const [selected, setSelected] = useState(null)
  const [lignes, setLignes] = useState([])

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const { data: c } = await supabase
      .from('commandes')
      .select('*, fournisseurs(nom, email, adresse, telephone, siret, franco_type, franco_valeur, frais_port_type, frais_port_montant, frais_port_texte)')
      .order('created_at', { ascending: false })
    const { data: f } = await supabase.from('fournisseurs').select('*').eq('etat', 'actif').order('nom')
    const { data: r } = await supabase.from('reglages').select('*').limit(1).single()
    setCommandes(c || [])
    setFournisseurs(f || [])
    setReglages(r || null)
    setLoading(false)
  }

  async function createCommande(fournisseurId) {
    const { data: commande } = await supabase
      .from('commandes')
      .insert({ fournisseur_id: fournisseurId, statut: 'brouillon' })
      .select()
      .single()

    const { data: produits } = await supabase
      .from('matieres_premieres_fournisseurs')
      .select('*, matieres_premieres(designation_interne, quantite_recommandee)')
      .eq('fournisseur_id', fournisseurId)

    if (produits && produits.length > 0) {
      const lignesToInsert = produits.map(p => ({
        commande_id: commande.id,
        matiere_premiere_fournisseur_id: p.id,
        quantite_commandee: p.matieres_premieres?.quantite_recommandee || 0,
        prix_unitaire_ht: p.prix_actuel,
        montant_ht: (p.matieres_premieres?.quantite_recommandee || 0) * p.prix_actuel
      }))
      await supabase.from('commandes_lignes').insert(lignesToInsert)
    }

    setShowNew(false)
    fetchAll()
    openDetail({ ...commande, fournisseurs: fournisseurs.find(f => f.id === fournisseurId) })
  }

async function creerFournisseurEtCommande() {
    if (!nouveauFournisseurNom) return alert('Le nom est obligatoire')
    const { data: nouveauF } = await supabase.from('fournisseurs').insert({ nom: nouveauFournisseurNom, etat: 'actif' }).select().single()
    setFournisseurs([...fournisseurs, nouveauF])
    setShowNewFournisseur(false)
    setNouveauFournisseurNom('')
    createCommande(nouveauF.id)
  }

  async function openDetail(commande) {
    setSelected(commande)
    const { data: l } = await supabase
      .from('commandes_lignes')
      .select('*, matieres_premieres_fournisseurs(designation_fournisseur, reference_fournisseur, conditionnement, matiere_premiere_id, matieres_premieres(designation_interne, unite))')
      .eq('commande_id', commande.id)
    setLignes(l || [])
    setShowDetail(true)
  }

  async function updateLigneQuantite(ligneId, quantite) {
    const ligne = lignes.find(l => l.id === ligneId)
    const montant = quantite * ligne.prix_unitaire_ht
    await supabase.from('commandes_lignes').update({ quantite_commandee: quantite, montant_ht: montant }).eq('id', ligneId)
    setLignes(lignes.map(l => l.id === ligneId ? { ...l, quantite_commandee: quantite, montant_ht: montant } : l))
  }

  function calculerTotaux() {
    const total = lignes.reduce((sum, l) => sum + (l.montant_ht || 0), 0)
    const f = selected?.fournisseurs
    let franco = 0
    let fraisPort = f?.frais_port_montant || 0
    let atteint80 = false

    if (f?.franco_type === 'montant' && f?.franco_valeur) {
      const seuil = parseFloat(f.franco_valeur)
      if (total >= seuil) {
        franco = 1
        fraisPort = 0
      } else if (total >= seuil * 0.8) {
        atteint80 = true
      }
    }
    return { total, franco, fraisPort, atteint80, seuilFranco: f?.franco_valeur }
  }

  async function envoyerCommande() {
    const totaux = calculerTotaux()
    await supabase.from('commandes').update({
      statut: 'envoyee',
      montant_total_ht: totaux.total,
      franco_estime: totaux.franco,
      frais_port_estime: totaux.fraisPort
    }).eq('id', selected.id)
    setShowDetail(false)
    fetchAll()
  }

async function deleteCommande() {
  if (!window.confirm('Supprimer définitivement cette commande ?')) return
  await supabase.from('commandes_lignes').delete().eq('commande_id', selected.id)
  await supabase.from('commandes').delete().eq('id', selected.id)
  setShowDetail(false)
  fetchAll()
}

  function exportPDF() {
    window.print()
  }

  function envoyerEmail() {
    const f = selected.fournisseurs
    const totaux = calculerTotaux()
    const lignesFiltrees = lignes.filter(l => (l.quantite_commandee || 0) >= 1)
    const corps = lignesFiltrees.map(l => `${l.matieres_premieres_fournisseurs?.designation_fournisseur} : ${l.quantite_commandee} unités`).join('%0D%0A')
    const sujet = encodeURIComponent(`Bon de commande - ${new Date().toLocaleDateString()}`)
    const expediteur = reglages?.nom_boulangerie || 'Notre boulangerie'
    const body = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-dessous notre commande :\n\n`) + corps + encodeURIComponent(`\n\nTotal HT estimé : ${totaux.total.toFixed(2)}€\n\nCordialement,\n${expediteur}`)
    
    const destinataires = [f?.email]
    if (reglages?.emails_secondaires) {
      const secondaires = reglages.emails_secondaires.split(',').map(e => e.trim()).filter(Boolean)
      destinataires.push(...secondaires)
    }
    const to = destinataires.filter(Boolean).join(',')
    window.location.href = `mailto:${to}?subject=${sujet}&body=${body}`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Commandes par fournisseur</h2>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
          <Plus size={16} /> Nouvelle commande
        </button>
      </div>

      {loading ? <p className="text-gray-400">Chargement...</p> : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {commandes.length === 0 && <p className="p-6 text-gray-400 text-sm">Aucune commande.</p>}
          {commandes.map(c => {
            const config = STATUT_CONFIG[c.statut]
            return (
              <div key={c.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(c)}>
                <div>
                  <p className="font-medium text-gray-800 text-sm">{c.fournisseurs?.nom}</p>
                  <p className="text-xs text-gray-400">{new Date(c.created_at).toLocaleDateString()} {c.montant_total_ht ? `— ${parseFloat(c.montant_total_ht).toFixed(2)}€ HT` : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${config.color}`}>{config.label}</span>
                  <ChevronRight size={16} className="text-gray-400" />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Choix fournisseur */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-800">Choisir un fournisseur</h3>
              <button onClick={() => setShowNew(false)}><X size={20} className="text-gray-400" /></button>
            </div>

            {!showNewFournisseur ? (
              <>
                {fournisseurs.length === 0 ? (
                  <p className="text-sm text-gray-400 mb-4">Aucun fournisseur actif pour le moment.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto mb-4">
                    {fournisseurs.map(f => (
                      <button key={f.id} onClick={() => createCommande(f.id)} className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-yellow-400 hover:bg-yellow-50 text-sm font-medium text-gray-700">
                        {f.nom}
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => setShowNewFournisseur(true)} className="w-full px-4 py-2.5 rounded-lg border border-dashed border-gray-300 text-sm font-medium text-gray-700 hover:border-yellow-400 hover:text-yellow-600">
                  + Nouveau fournisseur
                </button>
              </>
            ) : (
              <div className="space-y-3">
                <input placeholder="Nom du fournisseur *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={nouveauFournisseurNom} onChange={e => setNouveauFournisseurNom(e.target.value)} />
                <div className="flex gap-3">
                  <button onClick={() => setShowNewFournisseur(false)} className="flex-1 py-2 text-sm text-gray-700">Annuler</button>
                  <button onClick={creerFournisseurEtCommande} className="flex-1 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>Créer et commander</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Détail commande */}
      {/* Détail commande */}
      {showDetail && selected && (
        <CommandeDetail
          commande={selected}
          lignes={lignes}
          reglages={reglages}
          calculerTotaux={calculerTotaux}
          onClose={() => setShowDetail(false)}
          onUpdateQuantite={updateLigneQuantite}
          onEnvoyer={envoyerCommande}
          onExportPDF={exportPDF}
          onEnvoyerEmail={envoyerEmail}
          onDelete={deleteCommande}
        />
      )}
    </div>
  )
}

function CommandeDetail({ commande, lignes, reglages, calculerTotaux, onClose, onUpdateQuantite, onEnvoyer, onExportPDF, onEnvoyerEmail, onDelete }) {
  const totaux = calculerTotaux()
  const isEditable = commande.statut === 'brouillon'
  const lignesFiltrees = lignes.filter(l => (l.quantite_commandee || 0) >= 1)

  return (
    <>
      {/* Modal interactive */}
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 print:hidden">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-gray-800">{commande.fournisseurs?.nom}</h3>
              <p className="text-xs text-gray-400">{STATUT_CONFIG[commande.statut].label}</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={onDelete} className="text-sm text-red-500 hover:text-red-700 font-medium">Supprimer</button>
              <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
            </div>
          </div>

          {totaux.atteint80 && (
            <div className="flex items-center gap-2 bg-orange-50 text-orange-600 text-sm px-4 py-3 rounded-lg mb-4">
              <AlertTriangle size={16} />
              Vous approchez du seuil de franco de port ({totaux.seuilFranco}€)
            </div>
          )}
          {totaux.franco === 1 && (
            <div className="flex items-center gap-2 bg-green-50 text-green-600 text-sm px-4 py-3 rounded-lg mb-4">
              Franco de port atteint — livraison gratuite
            </div>
          )}

          {lignes.length === 0 ? (
            <div className="text-center py-8 mb-6 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-700 mb-3">Ce fournisseur n'a aucun produit lié dans la mercuriale.</p>
              <a href="/mercuriale" className="inline-block px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
                Ajouter des produits dans la mercuriale
              </a>
            </div>
          ) : (
            <div className="space-y-2 mb-6">
              {lignes.map(l => (
                <div key={l.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                  <div className="flex-1">
                    <p className="font-medium text-gray-700">{l.matieres_premieres_fournisseurs?.matieres_premieres?.designation_interne}</p>
                    <p className="text-xs text-gray-400">{l.matieres_premieres_fournisseurs?.designation_fournisseur} — Réf {l.matieres_premieres_fournisseurs?.reference_fournisseur}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    {isEditable ? (
                      <div className="flex flex-col items-end">
                        <input
                          type="number"
                          className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right"
                          value={l.quantite_commandee || 0}
                          onChange={e => onUpdateQuantite(l.id, parseFloat(e.target.value) || 0)}
                        />
                        <span className="text-xs text-gray-400 mt-1">
                          {l.quantite_commandee || 0} × {l.matieres_premieres_fournisseurs?.conditionnement}{l.matieres_premieres_fournisseurs?.matieres_premieres?.unite || ''} = {((l.quantite_commandee || 0) * (l.matieres_premieres_fournisseurs?.conditionnement || 0)).toFixed(1)}{l.matieres_premieres_fournisseurs?.matieres_premieres?.unite || ''}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-600">{l.quantite_commandee}</span>
                    )}
                    <span className="font-medium text-gray-700 w-20 text-right">{parseFloat(l.montant_ht || 0).toFixed(2)}€</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-gray-100 pt-4 space-y-1 mb-6">
            <div className="flex justify-between text-sm text-gray-700">
              <span>Montant total HT</span>
              <span className="font-medium text-gray-800">{totaux.total.toFixed(2)}€</span>
            </div>
            <div className="flex justify-between text-sm text-gray-700">
              <span>Frais de port</span>
              <span className="font-medium text-gray-800">{totaux.fraisPort}€</span>
            </div>
          </div>

          {isEditable && (
            <div className="flex gap-3">
              <button onClick={onExportPDF} className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                <FileDown size={16} /> Export PDF
              </button>
              <button onClick={onEnvoyerEmail} className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                <Mail size={16} /> Email fournisseur
              </button>
              <button onClick={onEnvoyer} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#C9A84C' }}>
                <Send size={16} /> Marquer comme envoyée
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Template impression uniquement */}
      <div className="hidden print:block fixed inset-0 bg-white p-10">
        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-xs text-gray-700 uppercase mb-1">Émetteur</p>
            <p className="font-bold text-gray-800">{reglages?.nom_boulangerie || 'Ma Boulangerie'}</p>
            <p className="text-sm text-gray-700">{reglages?.adresse}</p>
            <p className="text-sm text-gray-700">{reglages?.telephone}</p>
            <p className="text-sm text-gray-700">{reglages?.email}</p>
            {reglages?.siret && <p className="text-sm text-gray-700">SIRET : {reglages.siret}</p>}
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold" style={{ color: '#C9A84C' }}>BON DE COMMANDE</h1>
            <p className="text-sm text-gray-700 mt-1">Date : {new Date().toLocaleDateString('fr-FR')}</p>
            <p className="text-sm text-gray-700">N° : BC-{Date.now().toString().slice(-6)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-700 uppercase mb-1">Fournisseur</p>
            <p className="font-bold text-gray-800">{commande.fournisseurs?.nom}</p>
            <p className="text-sm text-gray-700">{commande.fournisseurs?.adresse}</p>
            <p className="text-sm text-gray-700">{commande.fournisseurs?.telephone}</p>
            <p className="text-sm text-gray-700">{commande.fournisseurs?.email}</p>
            {commande.fournisseurs?.siret && <p className="text-sm text-gray-700">SIRET : {commande.fournisseurs.siret}</p>}
          </div>
        </div>

        <div className="border-t-2 mb-6" style={{ borderColor: '#C9A84C' }} />

        <table className="w-full text-sm mb-8">
          <thead>
            <tr style={{ backgroundColor: '#C9A84C' }}>
              <th className="text-left py-2 px-3 font-semibold text-white">Référence</th>
              <th className="text-left py-2 px-3 font-semibold text-white">Désignation</th>
              <th className="text-right py-2 px-3 font-semibold text-white">Qté</th>
              <th className="text-right py-2 px-3 font-semibold text-white">Cond.</th>
              <th className="text-right py-2 px-3 font-semibold text-white">Prix unit. HT</th>
              <th className="text-right py-2 px-3 font-semibold text-white">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {lignesFiltrees.map((l, i) => (
              <tr key={l.id} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9F9F9' }}>
                <td className="py-2 px-3 text-gray-700">{l.matieres_premieres_fournisseurs?.reference_fournisseur}</td>
                <td className="py-2 px-3 text-gray-700">{l.matieres_premieres_fournisseurs?.designation_fournisseur}</td>
                <td className="py-2 px-3 text-right text-gray-700">{l.quantite_commandee}</td>
                <td className="py-2 px-3 text-right text-gray-700">{l.matieres_premieres_fournisseurs?.conditionnement}</td>
                <td className="py-2 px-3 text-right text-gray-700">{parseFloat(l.prix_unitaire_ht || 0).toFixed(2)}€</td>
                <td className="py-2 px-3 text-right font-medium text-gray-800">{parseFloat(l.montant_ht || 0).toFixed(2)}€</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-8">
          <div className="w-64 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Total HT</span>
              <span>{totaux.total.toFixed(2)}€</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Frais de port</span>
              <span>{totaux.fraisPort}€</span>
            </div>
            <div className="flex justify-between font-bold text-gray-800 pt-2 border-t-2" style={{ borderColor: '#C9A84C' }}>
              <span>Total estimé HT</span>
              <span>{(totaux.total + totaux.fraisPort).toFixed(2)}€</span>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4 text-xs text-gray-700 flex justify-end">
          <span>Bon de commande généré via Orpailleur</span>
        </div>
      </div>
    </>
  )
}