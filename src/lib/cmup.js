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

/**
 * Prix ramené à l'unité de base (gramme/ml/pièce), calculé à partir du montant
 * total payé et de la quantité totale réellement reçue — plutôt qu'à partir du
 * "prix unitaire" imprimé sur la facture, dont la convention (prix au kilo ?
 * au carton ? à la tonne ?) varie selon le fournisseur et n'est pas fiable à
 * elle seule. Le montant et la quantité totale, eux, ne sont jamais ambigus.
 */
export function quantiteEnUniteBase(quantite, conditionnement, unite) {
  const u = (unite || '').toLowerCase().trim()
  const conditionnementBase = (u === 'kg' || u === 'l') ? (Number(conditionnement) || 1) * 1000 : (Number(conditionnement) || 1)
  return (Number(quantite) || 0) * conditionnementBase
}

export function calculerPrixBaseDepuisTotal(montantTotal, quantiteBaseTotal) {
  if (!quantiteBaseTotal) return 0
  return (Number(montantTotal) || 0) / quantiteBaseTotal
}

export function calculerPrixBase(montant, quantite, conditionnement, unite) {
  return calculerPrixBaseDepuisTotal(montant, quantiteEnUniteBase(quantite, conditionnement, unite))
}

/** Prix au gramme/ml ramené à l'unité déclarée de l'article (€/kg, €/L...), pour l'affichage
 *  et le stockage de prix_actuel — toujours dérivé du prix au gramme fiable, jamais du "prix
 *  unitaire" imprimé sur facture (dont la convention est trop peu fiable pour être stockée telle quelle). */
export function prixBaseVersUnite(prixParGramme, unite) {
  const u = (unite || '').toLowerCase().trim()
  return (u === 'kg' || u === 'l') ? (Number(prixParGramme) || 0) * 1000 : (Number(prixParGramme) || 0)
}

/** Prix unitaire (tel qu'imprimé sur facture, déjà par kg/L/pièce) ramené à l'unité de base. */
export function convertirPrixUnitaireVersBase(prixUnitaire, unite) {
  const u = (unite || '').toLowerCase().trim()
  if (u === 'kg' || u === 'l') return (Number(prixUnitaire) || 0) / 1000
  return Number(prixUnitaire) || 0
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

/**
 * Correctif rétroactif d'un bug découvert le 28/08 : la fonction de calcul du prix
 * au gramme divisait le "prix unitaire" facture par le conditionnement une fois de
 * trop (elle le traitait comme un prix au carton, alors qu'il est déjà au kilo/litre
 * sur la plupart des factures). Résultat : CMUP sous-évalué d'un facteur = conditionnement.
 *
 * - matieres_premieres_fournisseurs.prix_g_u_ml est corrigé EXACTEMENT (recalculé à
 *   partir de prix_actuel + unite, déjà stockés correctement).
 * - mouvements_stock.prix_g_u_ml est corrigé par approximation (ancien prix × conditionnement
 *   actuellement connu du fournisseur) — le conditionnement exact au moment de chaque
 *   réception passée n'étant pas conservé individuellement.
 *
 * À lancer UNE SEULE FOIS (la fonction se bloque elle-même après un premier passage réussi).
 */
export async function corrigerBugConditionnement() {
  const { data: reglages } = await supabase.from('reglages').select('id, prix_historique_corrige_le').limit(1).maybeSingle()
  if (reglages?.prix_historique_corrige_le) {
    return { dejaFait: true, corrigeLe: reglages.prix_historique_corrige_le }
  }

  const { data: liens } = await supabase
    .from('matieres_premieres_fournisseurs')
    .select('id, matiere_premiere_id, prix_actuel, conditionnement, unite')

  let liensCorriges = 0
  const conditionnementParMatiere = {}
  for (const lien of liens || []) {
    const prixCorrige = convertirPrixUnitaireVersBase(lien.prix_actuel, lien.unite)
    await supabase.from('matieres_premieres_fournisseurs').update({ prix_g_u_ml: prixCorrige }).eq('id', lien.id)
    liensCorriges++
    if (!(lien.matiere_premiere_id in conditionnementParMatiere)) {
      conditionnementParMatiere[lien.matiere_premiere_id] = Number(lien.conditionnement) || 1
    }
  }

  const { data: mouvements } = await supabase
    .from('mouvements_stock')
    .select('id, matiere_premiere_id, prix_g_u_ml')
    .eq('type', 'reception')
    .not('prix_g_u_ml', 'is', null)

  let mouvementsCorriges = 0
  for (const m of mouvements || []) {
    const conditionnement = conditionnementParMatiere[m.matiere_premiere_id] || 1
    const prixCorrige = (Number(m.prix_g_u_ml) || 0) * conditionnement
    await supabase.from('mouvements_stock').update({ prix_g_u_ml: prixCorrige }).eq('id', m.id)
    mouvementsCorriges++
  }

  const matieresIds = [...new Set((mouvements || []).map((m) => m.matiere_premiere_id))]
  for (const id of matieresIds) {
    await recalculerCmup(id)
  }

  if (reglages?.id) {
    await supabase.from('reglages').update({ prix_historique_corrige_le: new Date().toISOString() }).eq('id', reglages.id)
  }

  return { dejaFait: false, liensCorriges, mouvementsCorriges, matieresRecalculees: matieresIds.length }
}
