// ============================================================
// Calcul du coût de revient — logique déterministe, pure, testable.
// Séparation lecture (Supabase, dans les pages) / calcul (ici),
// même principe que ocr.js pour la partie factures.
// ============================================================

/**
 * Coût forfaitaire d'une fournée selon la durée de cuisson,
 * par palier (le palier applicable est le plus grand seuil atteint).
 */
export function coutBareme(bareme, tpsCuissonMin) {
  const t = Number(tpsCuissonMin) || 0
  let val = 0
  const trie = [...bareme].sort((a, b) => a.tps_cuisson_min - b.tps_cuisson_min)
  for (const palier of trie) {
    if (t >= palier.tps_cuisson_min) val = palier.cout
  }
  return val
}

// ============================================================
// Conversion d'unité : le CMUP (mp.cmp) est TOUJOURS exprimé par unité de
// base (gramme, ml ou pièce), même si l'unité d'achat affichée est kg ou L
// (voir calculerPrixUnitaireBase dans Mercuriale.jsx). Une ligne de recette
// peut être saisie dans n'importe quelle unité compatible ; on la convertit
// systématiquement vers l'unité de base avant de multiplier par le CMUP.
// ============================================================

/** Unité de base dans laquelle le CMUP d'une matière première est exprimé. */
export function uniteBaseDe(mpUnite) {
  const u = (mpUnite || '').toLowerCase()
  if (u === 'kg') return 'g'
  if (u === 'l') return 'ml'
  return mpUnite || 'g'
}

/** Unités que l'utilisateur peut choisir en saisissant une ligne de recette. */
export function uniteesCompatibles(mpUnite) {
  const base = uniteBaseDe(mpUnite)
  if (base === 'g') return ['g', 'kg']
  if (base === 'ml') return ['ml', 'cl', 'L']
  return [base]
}

/** Facteur multiplicatif pour convertir une quantité saisie vers l'unité de base. */
export function facteurVersBase(uniteSaisie, mpUnite) {
  const u = (uniteSaisie || '').toLowerCase()
  const base = uniteBaseDe(mpUnite)
  if (u === base.toLowerCase()) return 1
  if (base === 'g' && u === 'kg') return 1000
  if (base === 'ml' && u === 'l') return 1000
  if (base === 'ml' && u === 'cl') return 10
  return 1 // unité inconnue -> on suppose déjà l'unité de base, par sécurité
}

/** Quantité d'une ligne de recette convertie dans l'unité de base du CMUP. */
export function quantiteEnBase(quantite, uniteSaisie, mpUnite) {
  return (Number(quantite) || 0) * facteurVersBase(uniteSaisie, mpUnite)
}

/**
 * Coût matière total d'une recette = somme des éléments (sous-recettes)
 * + somme des ingrédients rattachés directement à la recette.
 * `elements` : [{ ingredients: [{ quantite, unite, cmup, mp: { unite } }] }]
 * `ingredientsDirects` : [{ quantite, unite, cmup, mp: { unite } }]
 */
export function coutLigneIngredients(ingredients) {
  return (ingredients || []).reduce((s, ing) => {
    const qteBase = quantiteEnBase(ing.quantite, ing.unite, ing.mp?.unite)
    return s + qteBase * (Number(ing.cmup) || 0)
  }, 0)
}

export function coutMatiereRecette(elements, ingredientsDirects) {
  const totalElements = (elements || []).reduce((total, el) => total + coutLigneIngredients(el.ingredients), 0)
  const totalDirects = coutLigneIngredients(ingredientsDirects)
  return totalElements + totalDirects
}

/**
 * Calcule le coût de revient unitaire d'une recette.
 *
 * Qté produit  = nb de pièces que donne la recette telle qu'écrite (base matière)
 * Volume prod. = nb de pièces réellement produites en une fournée en atelier
 *   -> la matière est divisée par Qté produit (proportionnel, quelle que soit l'échelle)
 *   -> la MO et l'énergie sont divisées par Volume prod. (le temps de travail
 *      d'une fournée ne dépend pas linéairement du nombre de pièces dedans)
 */
export function calculerCoutRevient(recette, { tauxHoraire, bareme, perteDefaut, elements, ingredientsDirects }) {
  const matiereRecette = coutMatiereRecette(elements, ingredientsDirects)
  const qteProduit = Number(recette.qte_produit) || 1
  const volumeProd = Number(recette.volume_prod) || qteProduit || 1
  const matiereU = matiereRecette / qteProduit

  const tpsPrepa = recette.tps_prepa_min
  const moU = tpsPrepa
    ? ((Number(tauxHoraire) || 0) / 60) * Number(tpsPrepa) / volumeProd
    : 0

  const energieLot = coutBareme(bareme || [], recette.tps_cuisson_min)
  const energieU = volumeProd ? energieLot / volumeProd : 0

  const packagingU = Number(recette.packaging_u) || 0
  const perte = recette.perte_pct != null ? Number(recette.perte_pct) : Number(perteDefaut) || 0

  const coutRevientU = (matiereU + moU + energieU + packagingU) * (1 + perte)

  return { matiereRecette, matiereU, moU, energieU, packagingU, perte, coutRevientU }
}

/** Taux de marque = (PV HT - coût de revient) / PV HT. `null` si PV TTC absent. */
export function tauxMarque(coutRevientU, pvTtc, tvaPct) {
  if (!pvTtc) return null
  const pvHt = pvTtc / (1 + (Number(tvaPct) || 0))
  if (!pvHt) return null
  return (pvHt - coutRevientU) / pvHt
}

export function statutRecette(recette, coutRevientU, seuilMarge) {
  if (recette.est_composant) return { code: 'composant', label: 'Composant' }
  if (!recette.tps_prepa_min) return { code: 'alerte', label: 'Temps prépa à caler (MO=0)' }
  const marque = tauxMarque(coutRevientU, recette.pv_ttc, recette.tva_pct)
  if (marque !== null && marque < seuilMarge) return { code: 'alerte', label: 'Marge faible' }
  return { code: 'ok', label: 'OK' }
}

/**
 * Résout le CMUP effectif d'une matière première pour une recette :
 * - si c'est un vrai article acheté -> son cmp (Mercuriale)
 * - si c'est un composant maison (praliné, etc.) -> son propre coût de revient calculé,
 *   avec résolution récursive et détection de cycle.
 *
 * `ctx` regroupe les données déjà chargées (une seule fois par écran) :
 *   matieresById, recettesParMpId, elementsParRecetteId, ingredientsParElementId,
 *   tauxHoraireParAtelier, bareme, perteDefaut
 */
export function resoudreCmup(matierePremiereId, ctx, dejaVus = new Set()) {
  const mp = ctx.matieresById[matierePremiereId]
  if (!mp) return 0

  const composant = ctx.recettesParMpId[matierePremiereId]
  if (!composant) return Number(mp.cmp) || 0

  if (dejaVus.has(matierePremiereId)) {
    throw new Error(
      `Dépendance circulaire détectée sur "${mp.designation_interne}" — vérifie les recettes composants.`
    )
  }
  const vus = new Set(dejaVus)
  vus.add(matierePremiereId)

  const elements = (ctx.elementsParRecetteId[composant.id] || []).map((el) => ({
    ...el,
    ingredients: (ctx.ingredientsParElementId[el.id] || []).map((ing) => ({
      ...ing,
      cmup: resoudreCmup(ing.matiere_premiere_id, ctx, vus),
      mp: ctx.matieresById[ing.matiere_premiere_id],
    })),
  }))
  const ingredientsDirects = (ctx.ingredientsDirectsParRecetteId[composant.id] || []).map((ing) => ({
    ...ing,
    cmup: resoudreCmup(ing.matiere_premiere_id, ctx, vus),
    mp: ctx.matieresById[ing.matiere_premiere_id],
  }))

  const { coutRevientU } = calculerCoutRevient(composant, {
    tauxHoraire: ctx.tauxHoraireParAtelier[composant.atelier_id] || 0,
    bareme: ctx.bareme,
    perteDefaut: ctx.perteDefaut,
    elements,
    ingredientsDirects,
  })
  return coutRevientU
}
