// ============================================================
// Import de recette depuis un fichier Word / PDF / Excel.
//
// Même philosophie que ocr.js pour les factures : l'IA ne fait QUE
// transcrire (désignation brute + quantité + unité telles qu'écrites),
// elle ne choisit JAMAIS quelle matière première de la Mercuriale
// correspond. Le rapprochement est fait ici, en JS déterministe,
// et reste une SUGGESTION — l'utilisateur valide ou corrige chaque
// ligne avant que quoi que ce soit ne soit enregistré.
// ============================================================

import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { supabase } from './supabase'

const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY

const RECIPE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'recette_boulangerie',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        nom_recette: { type: 'string' },
        famille: { type: 'string' },
        lignes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              designation: { type: 'string' },
              quantite: { type: 'string' },
              unite: { type: 'string' }
            },
            required: ['designation', 'quantite', 'unite']
          }
        }
      },
      required: ['nom_recette', 'famille', 'lignes']
    }
  }
}

const RECIPE_PROMPT = `Tu es un expert en lecture de fiches recettes pour une boulangerie-pâtisserie française.
On te donne une fiche recette (texte ou tableau). Transcris LITTÉRALEMENT ce qui est écrit, sans rien calculer ni interpréter :
- nom_recette : le nom du produit fini (ex: "Cookies Framboise")
- famille : la catégorie si elle est indiquée (ex: "Pâtisserie", "Viennoiserie", "Pain", "Snack"), sinon chaîne vide
- lignes : une ligne par ingrédient, dans l'ordre du document, avec :
  - designation : le nom de l'ingrédient tel qu'écrit (ex: "Farine T55", "Beurre doux")
  - quantite : le nombre tel qu'écrit, en texte (ex: "250", "1,5")
  - unite : l'unité telle qu'écrite (ex: "g", "kg", "ml", "cl", "L", "pièce", "u")

Ignore les titres de sections, instructions de préparation, temps de cuisson ou toute ligne qui n'est pas un ingrédient avec une quantité.
Ne déduis JAMAIS une correspondance avec un produit acheté : contente-toi de transcrire le nom tel qu'il apparaît dans le document.`

/** Extrait le texte brut d'un fichier .docx (mise en page ignorée, texte uniquement). */
export async function extraireTexteDocx(file) {
  const arrayBuffer = await file.arrayBuffer()
  const { value } = await mammoth.extractRawText({ arrayBuffer })
  return value
}

/** Extrait toutes les feuilles d'un fichier .xlsx/.xls sous forme de texte (CSV par feuille). */
export async function extraireTexteXlsx(file) {
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  return wb.SheetNames.map((nom) => `# ${nom}\n${XLSX.utils.sheet_to_csv(wb.Sheets[nom])}`).join('\n\n')
}

function parseReponseIA(text) {
  let brut
  try {
    brut = JSON.parse(text)
  } catch {
    throw new Error("L'IA n'a pas renvoyé un format exploitable. Réessaie, ou vérifie le fichier.")
  }
  return {
    nomRecette: brut.nom_recette || '',
    famille: brut.famille || '',
    lignes: (brut.lignes || [])
      .filter((l) => l.designation)
      .map((l) => ({
        designation: l.designation,
        quantite: parseFloat(String(l.quantite).replace(',', '.')) || '',
        unite: normaliserUnite(l.unite)
      }))
  }
}

function normaliserUnite(u) {
  const s = (u || '').toLowerCase().trim()
  if (['g', 'gr', 'gramme', 'grammes'].includes(s)) return 'g'
  if (['kg', 'kilo', 'kilos', 'kilogramme', 'kilogrammes'].includes(s)) return 'kg'
  if (['ml', 'millilitre', 'millilitres'].includes(s)) return 'ml'
  if (['cl', 'centilitre', 'centilitres'].includes(s)) return 'cl'
  if (['l', 'litre', 'litres'].includes(s)) return 'L'
  if (['pcs', 'piece', 'pièce', 'pieces', 'pièces', 'u', 'unite', 'unité'].includes(s)) return 'pcs'
  return s || 'g'
}

/** PDF (scanné ou natif) -> extraction structurée directe via l'OCR Mistral, comme pour les factures. */
export async function extraireRecettePdf(base64Pdf) {
  const response = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: `data:application/pdf;base64,${base64Pdf}` },
      document_annotation_format: RECIPE_SCHEMA,
      document_annotation_prompt: RECIPE_PROMPT,
      include_image_base64: false
    })
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Erreur API OCR Mistral (${response.status}): ${errText}`)
  }
  const data = await response.json()
  return parseReponseIA(data.document_annotation)
}

/** Texte brut (issu d'un .docx ou .xlsx) -> extraction structurée via un appel de complétion. */
export async function extraireRecetteTexte(texteBrut) {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral-large-latest',
      messages: [
        { role: 'system', content: RECIPE_PROMPT },
        { role: 'user', content: texteBrut }
      ],
      response_format: RECIPE_SCHEMA
    })
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Erreur API Mistral (${response.status}): ${errText}`)
  }
  const data = await response.json()
  return parseReponseIA(data.choices?.[0]?.message?.content)
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'))
    reader.readAsDataURL(file)
  })
}

/**
 * Point d'entrée unique : dispatch selon l'extension du fichier.
 * Retourne { nomRecette, famille, lignes: [{ designation, quantite, unite }] }.
 */
export async function extraireRecetteDeFichier(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext === 'pdf') {
    const base64 = await fileToBase64(file)
    return extraireRecettePdf(base64)
  }
  if (ext === 'docx') {
    const texte = await extraireTexteDocx(file)
    return extraireRecetteTexte(texte)
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const texte = await extraireTexteXlsx(file)
    return extraireRecetteTexte(texte)
  }
  throw new Error(`Format .${ext} non supporté. Utilise un fichier .docx, .pdf, .xlsx ou .xls.`)
}

// ---- Rapprochement local avec la Mercuriale (jamais envoyé à l'IA) ----

function normaliserTexte(s) {
  return (s || '')
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae') // ligatures non décomposées par NFD (Œuf, Bœuf...)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((mot) => (mot.length >= 4 && mot.endsWith('s') ? mot.slice(0, -1) : mot)) // singulier/pluriel naïf
}

/**
 * Cherche la matière première la plus proche par chevauchement de mots :
 * le score mesure la part des mots du terme le plus court retrouvée dans l'autre,
 * ce qui permet à "Beurre" de matcher "Beurre doux AOP Charentes" (désignation
 * abrégée, cas fréquent dans les recettes) sans pénaliser les mots en trop côté Mercuriale.
 *
 * Sécurité : si plusieurs matières sont candidates à un score proche du meilleur
 * (ambiguïté réelle, ex: "Sucre" face à "Sucre cristal" ET "Sucre glace"), on
 * retourne null plutôt que de deviner — l'utilisateur choisit alors lui-même.
 */
export function suggererMatierePremiere(designation, matieres, seuil = 0.6, margeAmbiguite = 0.15) {
  const mots = new Set(normaliserTexte(designation))
  if (mots.size === 0) return null

  const scores = matieres
    .map((mp) => {
      const motsMp = new Set(normaliserTexte(mp.designation_interne))
      if (motsMp.size === 0) return { mp, score: 0 }
      const intersection = [...mots].filter((m) => motsMp.has(m)).length
      const plusPetit = Math.min(mots.size, motsMp.size)
      const score = plusPetit ? intersection / plusPetit : 0
      return { mp, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scores.length === 0 || scores[0].score < seuil) return null
  const concurrents = scores.filter((s) => scores[0].score - s.score <= margeAmbiguite)
  if (concurrents.length > 1) return null // ambigu -> à choisir manuellement

  return scores[0].mp
}

/**
 * Retourne les N matières premières les plus proches d'une désignation,
 * classées par score de chevauchement — sans logique d'ambiguïté cette fois
 * (utilisé pour proposer des suggestions rapides à l'utilisateur, qui choisit).
 */
export function suggererCandidats(designation, matieres, n = 4) {
  const mots = new Set(normaliserTexte(designation))
  if (mots.size === 0) return []
  return matieres
    .map((mp) => {
      const motsMp = new Set(normaliserTexte(mp.designation_interne))
      if (motsMp.size === 0) return { mp, score: 0 }
      const intersection = [...mots].filter((m) => motsMp.has(m)).length
      const plusPetit = Math.min(mots.size, motsMp.size)
      return { mp, score: plusPetit ? intersection / plusPetit : 0 }
    })
    .filter((s) => s.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((s) => s.mp)
}

/**
 * Liste, groupée par désignation unique, tous les ingrédients de recette
 * encore en attente — pour un rapprochement groupé (une décision par
 * désignation, appliquée à toutes les recettes qui l'utilisent d'un coup).
 */
export async function listerIngredientsEnAttenteGroupes() {
  const [{ data: enAttente }, { data: matieres }, { data: recettesAll }, { data: elementsAll }] = await Promise.all([
    supabase.from('recette_ingredients').select('id, designation_brute, recette_id, element_id').is('matiere_premiere_id', null).not('designation_brute', 'is', null),
    supabase.from('matieres_premieres').select('id, designation_interne, unite'),
    supabase.from('recettes').select('id, nom'),
    supabase.from('recette_elements').select('id, recette_id'),
  ])

  const nomParRecetteId = Object.fromEntries((recettesAll || []).map((r) => [r.id, r.nom]))
  const recetteIdParElementId = Object.fromEntries((elementsAll || []).map((e) => [e.id, e.recette_id]))

  const groupes = {}
  for (const ligne of enAttente || []) {
    const cle = ligne.designation_brute.trim().toLowerCase()
    groupes[cle] ||= { designation: ligne.designation_brute.trim(), ids: [], recettes: new Set() }
    groupes[cle].ids.push(ligne.id)
    const recetteId = ligne.recette_id || recetteIdParElementId[ligne.element_id]
    if (nomParRecetteId[recetteId]) groupes[cle].recettes.add(nomParRecetteId[recetteId])
  }

  return {
    groupes: Object.values(groupes)
      .map((g) => ({ ...g, recettes: [...g.recettes], candidats: suggererCandidats(g.designation, matieres || []) }))
      .sort((a, b) => b.ids.length - a.ids.length),
    matieres: matieres || [],
  }
}

/** Applique un rapprochement à toutes les lignes d'un groupe (même désignation) d'un coup. */
export async function appliquerRapprochementGroupe(ids, matierePremiereId) {
  await supabase.from('recette_ingredients').update({ matiere_premiere_id: matierePremiereId, designation_brute: null }).in('id', ids)
}

/**
 * Tente de rapprocher automatiquement toutes les lignes d'ingrédients "en attente"
 * (designation_brute renseignée, matiere_premiere_id encore vide) avec les articles
 * Mercuriale actuels. Ne force jamais un rapprochement ambigu — voir suggererMatierePremiere.
 * À appeler après toute création d'article (nouvelle facture, ajout manuel en Mercuriale)
 * et disponible aussi comme action manuelle depuis la page Recettes.
 */
export async function reconcilierIngredientsEnAttente() {
  const { data: enAttente } = await supabase
    .from('recette_ingredients')
    .select('id, designation_brute')
    .is('matiere_premiere_id', null)
    .not('designation_brute', 'is', null)

  if (!enAttente || enAttente.length === 0) return { rapproches: 0, total: 0 }

  const { data: matieres } = await supabase
    .from('matieres_premieres')
    .select('id, designation_interne')

  let rapproches = 0
  for (const ligne of enAttente) {
    const match = suggererMatierePremiere(ligne.designation_brute, matieres || [])
    if (match) {
      await supabase.from('recette_ingredients').update({ matiere_premiere_id: match.id }).eq('id', ligne.id)
      rapproches++
    }
  }
  return { rapproches, total: enAttente.length }
}
