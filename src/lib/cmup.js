// ============================================================
// CMUP (coût moyen unitaire pondéré) — matieres_premieres.cmp
//
// Exemple de référence (celui donné par l'utilisateur) : une canette de Coca
// achetée 1€ chez un fournisseur et 1,20€ chez un autre ne permet pas de savoir
// laquelle sera donnée à un client donné -> le coût retenu est la moyenne des
// deux prix, PONDÉRÉE par les quantités achetées à chaque prix.
//
// Donnée source : mouvements_stock (type='reception'), avec le prix par unité
// de base (g/ml/pièce) enregistré au moment de CHAQUE réception — pas un prix
// unique écrasé à chaque facture, pour que l'historique reste exploitable.
// ============================================================

import { supabase } from './supabase'

/** Prix ramené à l'unité de base (gramme/ml/pièce) — kg et L sont convertis, le reste passe tel quel. */
export function calculerPrixBase(prix, conditionnement, unite) {
  const u = (unite || '').toLowerCase().trim()
  if (u === 'kg' || u === 'l') return prix / (conditionnement * 1000)
  return prix / conditionnement
}

/** Recalcule et enregistre le CMUP d'une matière première à partir de son historique de réceptions. */
export async function recalculerCmup(matierePremiereId) {
  const { data: mouvements, error } = await supabase
    .from('mouvements_stock')
    .select('quantite, prix_g_u_ml')
    .eq('matiere_premiere_id', matierePremiereId)
    .eq('type', 'reception')
    .not('prix_g_u_ml', 'is', null)

  if (error || !mouvements || mouvements.length === 0) return null

  const totalQuantite = mouvements.reduce((s, m) => s + (Number(m.quantite) || 0), 0)
  const totalValeur = mouvements.reduce((s, m) => s + (Number(m.quantite) || 0) * (Number(m.prix_g_u_ml) || 0), 0)
  if (totalQuantite <= 0) return null

  const cmp = totalValeur / totalQuantite
  await supabase.from('matieres_premieres').update({ cmp }).eq('id', matierePremiereId)
  return cmp
}

/**
 * Rattrapage pour l'historique existant : les mouvements de réception passés
 * n'ont pas de prix enregistré (le champ n'existait pas encore). On leur
 * attribue le prix actuellement connu de leur fournisseur (meilleure estimation
 * disponible, faute d'avoir le prix exact du jour de la réception), puis on
 * recalcule le CMUP de toutes les matières concernées.
 * À lancer une fois depuis la Mercuriale.
 */
export async function rattraperCmupHistorique() {
  const { data: mouvementsSansPrix } = await supabase
    .from('mouvements_stock')
    .select('id, matiere_premiere_id')
    .eq('type', 'reception')
    .is('prix_g_u_ml', null)

  if (!mouvementsSansPrix || mouvementsSansPrix.length === 0) return { corriges: 0, matieres: 0 }

  const matiereIds = [...new Set(mouvementsSansPrix.map((m) => m.matiere_premiere_id))]
  const { data: liens } = await supabase
    .from('matieres_premieres_fournisseurs')
    .select('matiere_premiere_id, prix_g_u_ml')
    .in('matiere_premiere_id', matiereIds)

  // S'il y a plusieurs fournisseurs pour une même matière, on prend la moyenne simple
  // de leurs prix actuels (faute de connaître la répartition réelle des quantités passées).
  const prixMoyenParMatiere = {}
  for (const id of matiereIds) {
    const prixFournisseurs = (liens || []).filter((l) => l.matiere_premiere_id === id && l.prix_g_u_ml != null).map((l) => Number(l.prix_g_u_ml))
    if (prixFournisseurs.length > 0) {
      prixMoyenParMatiere[id] = prixFournisseurs.reduce((a, b) => a + b, 0) / prixFournisseurs.length
    }
  }

  let corriges = 0
  for (const mouvement of mouvementsSansPrix) {
    const prix = prixMoyenParMatiere[mouvement.matiere_premiere_id]
    if (prix == null) continue
    await supabase.from('mouvements_stock').update({ prix_g_u_ml: prix }).eq('id', mouvement.id)
    corriges++
  }

  for (const id of matiereIds) {
    await recalculerCmup(id)
  }

  return { corriges, matieres: matiereIds.length }
}
