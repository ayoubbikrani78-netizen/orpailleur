// ============================================================
// Regroupement fournisseurs : reconnaît qu'un nom de fournisseur lu sur
// une facture correspond à un fournisseur déjà existant, même écrit
// différemment ("SAS MONEL et FILS" / "Monel et Fils Disgroup" / "Monel &
// Fils Disgroup") — pour ne jamais créer de fiche en double.
//
// Même principe de prudence que le regroupement d'articles Mercuriale :
// on retire les mots "bruit" (formes juridiques, connecteurs), et on ne
// fusionne que si le nom le plus court est entièrement inclus dans l'autre.
// ============================================================

import { supabase } from './supabase'

const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'au', 'aux', 'en', 'a', 'l', 'd'])

const FORMES_JURIDIQUES = new Set([
  'sas', 'sasu', 'sarl', 'eurl', 'sa', 'sci', 'scop', 'sc', 'ei', 'eirl',
  'ets', 'etablissements', 'cie', 'compagnie', 'groupe', 'group', 'disgroup', 'ste', 'societe'
])

function normaliser(s) {
  return (s || '')
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function motsContenu(nom) {
  return normaliser(nom).filter((m) => m.length > 1 && !MOTS_VIDES.has(m) && !FORMES_JURIDIQUES.has(m))
}

/** true si les deux noms désignent probablement la même entreprise. */
export function estMemeFournisseur(nomA, nomB) {
  const a = new Set(motsContenu(nomA))
  const b = new Set(motsContenu(nomB))
  if (a.size === 0 || b.size === 0) return false
  const intersection = [...a].filter((m) => b.has(m))
  if (intersection.length === 0) return false
  const diffA = [...a].some((m) => !b.has(m))
  const diffB = [...b].some((m) => !a.has(m))
  return !(diffA && diffB)
}

/** Cherche, parmi les fournisseurs déjà existants, celui qui correspond au même nom (ambigu = aucun résultat, par sécurité). */
export function trouverFournisseurCorrespondant(nom, fournisseursExistants) {
  const candidats = fournisseursExistants.filter((f) => estMemeFournisseur(nom, f.nom))
  return candidats.length === 1 ? candidats[0] : null
}

/**
 * Regroupe une liste de fournisseurs en paquets de doublons probables
 * (composantes connexes du graphe de correspondance).
 */
export function detecterGroupesDoublons(fournisseurs) {
  const parent = new Map(fournisseurs.map((f) => [f.id, f.id]))
  function find(id) {
    while (parent.get(id) !== id) id = parent.get(id)
    return id
  }
  function union(a, b) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (let i = 0; i < fournisseurs.length; i++) {
    for (let j = i + 1; j < fournisseurs.length; j++) {
      if (estMemeFournisseur(fournisseurs[i].nom, fournisseurs[j].nom)) {
        union(fournisseurs[i].id, fournisseurs[j].id)
      }
    }
  }
  const groupes = {}
  for (const f of fournisseurs) {
    const racine = find(f.id);
    (groupes[racine] ||= []).push(f)
  }
  return Object.values(groupes).filter((g) => g.length > 1)
}

/**
 * Fusionne un groupe de fournisseurs doublons en un seul.
 * `canonique` = fiche conservée. Les autres sont réassignées puis supprimées.
 * Les champs vides du canonique sont complétés ; les valeurs qui diffèrent
 * (ex: deux numéros de téléphone différents) sont concaténées plutôt que perdues.
 */
export async function fusionnerFournisseurs(canonique, doublons) {
  const patch = {}
  for (const champ of ['adresse', 'telephone', 'email', 'siret', 'siren']) {
    const valeurs = new Set([canonique[champ], ...doublons.map((d) => d[champ])].filter(Boolean))
    if (valeurs.size > 0) patch[champ] = [...valeurs].join(' / ')
  }
  if (Object.keys(patch).length > 0) {
    await supabase.from('fournisseurs').update(patch).eq('id', canonique.id)
  }

  const idsDoublons = doublons.map((d) => d.id)
  await supabase.from('factures').update({ fournisseur_id: canonique.id }).in('fournisseur_id', idsDoublons)
  await supabase.from('matieres_premieres_fournisseurs').update({ fournisseur_id: canonique.id }).in('fournisseur_id', idsDoublons)
  await supabase.from('commandes').update({ fournisseur_id: canonique.id }).in('fournisseur_id', idsDoublons)
  await supabase.from('fournisseurs').delete().in('id', idsDoublons)
}
