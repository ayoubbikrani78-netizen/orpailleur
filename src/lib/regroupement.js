// ============================================================
// Regroupement fournisseurs : reconnaît qu'un article de facture
// correspond à une matière première déjà existante, même vendue par
// un autre fournisseur sous une désignation différente — pour que le
// CMUP se calcule sur l'ensemble des fournisseurs (l'objectif initial :
// une canette à 1€ chez l'un, 1,20€ chez l'autre -> un seul article,
// coût moyen pondéré par les quantités réellement achetées à chacun).
//
// Principe volontairement prudent : deux désignations sont considérées
// comme LE MÊME article seulement si tous les mots significatifs de
// l'une sont inclus dans l'autre (l'écart ne porte que sur du bruit —
// conditionnement, marque, mention technique — jamais sur un mot de
// contenu propre à chaque côté). Dès que les deux désignations ont
// CHACUNE un mot de contenu que l'autre n'a pas (ex: "blanc" vs "jaune"),
// on considère qu'il s'agit d'articles différents et on ne fusionne pas.
// ============================================================

import { supabase } from './supabase'

const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'au', 'aux', 'en', 'a', 'avec', 'pour', 'sans', 'sur', 'l', 'd'])

// Bruit typique des désignations de facture : conditionnement, mentions
// techniques génériques — jamais des mots qui décrivent le produit lui-même.
const MOTS_BRUIT = new Set([
  'sac', 'ct', 'vrac', 'sc', 'briq', 'bq', 'bte', 'boite', 'boîte', 'pot', 'seau',
  'carton', 'colis', 'bidon', 'plaque', 'cube', 'bloc', 'mc', 'mdd', 'disg', 'disgr',
  'odf', 'sol', 'liq', 'pce', 'pc', 'gr', 'ref', 'reference', 'france', 'pre', 'ferme'
])

function normaliser(s) {
  return (s || '')
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((mot) => (mot.length >= 4 && mot.endsWith('s') ? mot.slice(0, -1) : mot))
}

/** Mots de contenu d'une désignation : sans mots vides, sans bruit de conditionnement, sans nombres. */
function motsContenu(designation) {
  return normaliser(designation).filter((m) => m.length > 1 && !MOTS_VIDES.has(m) && !MOTS_BRUIT.has(m) && !/\d/.test(m))
}

/**
 * true si les deux désignations décrivent le même article : tout le
 * contenu de l'une est inclus dans l'autre (l'écart n'est que du bruit
 * ou des mots ajoutés d'un seul côté, jamais une substitution des deux côtés).
 */
export function estMemeArticle(designationA, designationB) {
  const a = new Set(motsContenu(designationA))
  const b = new Set(motsContenu(designationB))
  if (a.size === 0 || b.size === 0) return false
  const intersection = [...a].filter((m) => b.has(m))
  if (intersection.length === 0) return false
  const diffA = [...a].some((m) => !b.has(m))
  const diffB = [...b].some((m) => !a.has(m))
  return !(diffA && diffB) // l'un des deux côtés doit être entièrement inclus dans l'autre
}

/**
 * Cherche, parmi les matières premières déjà existantes, celle qui
 * correspond au même article. Ne retourne un résultat que si un SEUL
 * candidat correspond (ambigu = aucune fusion automatique, par sécurité).
 */
export function trouverArticleCorrespondant(designation, matieresExistantes) {
  const candidats = matieresExistantes.filter((mp) => estMemeArticle(designation, mp.designation_interne))
  return candidats.length === 1 ? candidats[0] : null
}

const PREFIXES_CODE = {
  'Boissons': 'BO',
  'Consommables': 'CO',
  'Crèmerie': 'CR',
  'Fruits & Légumes frais': 'FL',
  'Fruits secs & oléagineux': 'FS',
  'Meunerie': 'ME',
  'Surgelés': 'SU',
  'Traiteur / Snacking salé': 'TR',
  'Épicerie': 'EP',
  'Épicerie sucrée': 'ES'
}

/** Génère le prochain code disponible pour une catégorie donnée (ex: CR001, CR002...). */
export async function genererCodeInterne(univers) {
  const prefix = PREFIXES_CODE[univers] || 'XX'
  const { data } = await supabase.from('matieres_premieres').select('code').ilike('code', `${prefix}%`)
  const numeros = (data || []).map((r) => parseInt((r.code || '').slice(prefix.length), 10)).filter((n) => !isNaN(n))
  const suivant = numeros.length ? Math.max(...numeros) + 1 : 1
  return `${prefix}${String(suivant).padStart(3, '0')}`
}

/** Assigne un code à une matière première qui n'en a pas encore, maintenant que sa catégorie est connue. */
export async function assignerCodeSiManquant(matierePremiereId, univers) {
  if (!univers) return null
  const { data: mp } = await supabase.from('matieres_premieres').select('code').eq('id', matierePremiereId).single()
  if (mp?.code) return mp.code
  const code = await genererCodeInterne(univers)
  await supabase.from('matieres_premieres').update({ code }).eq('id', matierePremiereId)
  return code
}
