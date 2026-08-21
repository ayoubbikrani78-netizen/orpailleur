// ============================================================
// Bases et Appareils : des sous-recettes réutilisables (pâte à choux,
// crème pâtissière, pâte à pizza...) qui deviennent, une fois créées,
// des "ingrédients" utilisables dans n'importe quelle recette finale.
//
// Mécanique : chaque Base est une recette normale (est_composant = true)
// reliée à un article Mercuriale virtuel (matiere_premiere_id) — le même
// mécanisme déjà utilisé pour les pralinés maison. Ça branche gratuitement
// sur tout le moteur de calcul existant (resoudreCmup gère déjà la
// résolution récursive).
// ============================================================

import { supabase } from './supabase'

export async function creerBase({ nom, famille, unite, atelierId, qteProduit, volumeProd, tpsPrepaMin, tpsCuissonMin, packagingU }) {
  const { data: mp, error: errMp } = await supabase.from('matieres_premieres').insert({
    designation_interne: nom,
    unite: unite || 'g',
    stock_mini: 0,
    seuil_rouge: 3,
    seuil_orange: 7
  }).select().single()
  if (errMp) throw errMp

  const { data: recette, error: errRecette } = await supabase.from('recettes').insert({
    nom,
    famille,
    atelier_id: atelierId || null,
    qte_produit: parseFloat(qteProduit) || 1,
    volume_prod: parseFloat(volumeProd) || parseFloat(qteProduit) || 1,
    tps_prepa_min: tpsPrepaMin === '' || tpsPrepaMin == null ? null : parseFloat(tpsPrepaMin),
    tps_cuisson_min: parseFloat(tpsCuissonMin) || 0,
    packaging_u: parseFloat(packagingU) || 0,
    est_composant: true,
    matiere_premiere_id: mp.id
  }).select().single()

  if (errRecette) {
    // Nettoyage si l'étape 2 échoue, pour ne pas laisser un article Mercuriale orphelin
    await supabase.from('matieres_premieres').delete().eq('id', mp.id)
    throw errRecette
  }

  return { recette, matierePremiere: mp }
}

/** Toutes les Bases et Appareils existants, avec leur article Mercuriale virtuel lié. */
export async function listerBases() {
  const { data: recettes } = await supabase.from('recettes').select('*').eq('est_composant', true).order('famille').order('nom')
  const mpIds = (recettes || []).map((r) => r.matiere_premiere_id).filter(Boolean)
  const { data: matieres } = mpIds.length
    ? await supabase.from('matieres_premieres').select('id, designation_interne, unite, cmp').in('id', mpIds)
    : { data: [] }
  const matieresById = Object.fromEntries((matieres || []).map((m) => [m.id, m]))
  return (recettes || []).map((r) => ({ ...r, matierePremiere: matieresById[r.matiere_premiere_id] }))
}
