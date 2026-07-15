// Module OCR partagé — utilisé par Factures.jsx et Reception.jsx
// Remplace l'ancienne approche (pdf.js -> canvas -> pixtral-12b-2409, modèle désormais déprécié)
// par l'API Document AI de Mistral (mistral-ocr-latest), spécialisée dans la lecture de documents
// (multi-pages natif, robuste aux filigranes/tampons/scans de mauvaise qualité).

const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY

const INVOICE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'facture_boulangerie',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fournisseur: {
          type: 'object',
          additionalProperties: false,
          properties: {
            nom: { type: 'string' },
            adresse: { type: 'string' },
            telephone: { type: 'string' },
            email: { type: 'string' },
            siret: { type: 'string' },
            siren: { type: 'string' }
          },
          required: ['nom', 'adresse', 'telephone', 'email', 'siret', 'siren']
        },
        facture: {
          type: 'object',
          additionalProperties: false,
          properties: {
            numero: { type: 'string' },
            date: { type: 'string' },
            echeance: { type: 'string' },
            delai_paiement_jours: { type: 'number' },
            montant_total_ht: { type: 'number' },
            montant_total_ttc: { type: 'number' }
          },
          required: ['numero', 'date', 'echeance', 'delai_paiement_jours', 'montant_total_ht', 'montant_total_ttc']
        },
        lignes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              reference: { type: 'string' },
              designation: { type: 'string' },
              conditionnement: { type: 'number' },
              unite: { type: 'string' },
              prix_unitaire_ht: { type: 'number' },
              quantite: { type: 'number' },
              montant_ht: { type: 'number' }
            },
            required: ['reference', 'designation', 'conditionnement', 'unite', 'prix_unitaire_ht', 'quantite', 'montant_ht']
          }
        }
      },
      required: ['fournisseur', 'facture', 'lignes']
    }
  }
}

const ANNOTATION_PROMPT = `Tu es un expert en lecture de factures fournisseurs pour une boulangerie française.
Ce document peut être n'importe quel type de facture (grande distribution, grossiste, artisan, multi-pages avec plusieurs bons de livraison, etc.) — adapte-toi à sa mise en page réelle plutôt qu'à un format supposé.

RÈGLE PRIORITAIRE SUR LES SURIMPRESSIONS :
Si le document comporte un filigrane, tampon ou mention en surimpression (ex: "DUPLICATA", "COPIE", "ANNULE ET REMPLACE"), ignore-le complètement pour l'extraction : ce n'est qu'une surcouche visuelle, pas une donnée de facture. Lis à travers cette surcouche pour retrouver le texte imprimé original (fournisseur, montants, lignes) exactement comme tu le ferais sans elle.

RÈGLES POUR LES LIGNES PRODUITS :
Deux mises en page sont possibles selon le fournisseur, adapte-toi à celle du document :

1) Facture "grossiste" classique (une colonne QUANTITE = nb de colis, une colonne P.U. = prix par colis, poids/volume parfois en colonne séparée) :
- "quantite" = nombre de colis/unités achetés (colonne QUANTITE)
- "conditionnement" = poids ou volume TOTAL par colis (ex: "1KG" -> 1, "13 kg" -> 13, "2kg" -> 2)
- "prix_unitaire_ht" = prix unitaire HT (colonne P.U. NET ou P.U. BRUT)

2) Ticket type "libre-service" (colonnes Prix unitaire / Colisage / Qté / Montant, sans colonne dédiée au poids) :
- "quantite" = la colonne Qté (nombre d'unités achetées, distincte de "Colisage")
- "prix_unitaire_ht" = la colonne Prix unitaire
- "montant_ht" = la colonne Montant (doit être environ égal à prix_unitaire_ht × quantite ; utilise ça pour identifier laquelle des colonnes numériques est laquelle si l'ordre n'est pas évident)
- "conditionnement" et "unite" ne sont alors PAS dans une colonne séparée : ils sont cachés dans le texte de la désignation du produit. Repère les motifs comme "2.5KG", "500G", "10X125G", "15K", "1,15L", "6KG", "33CLx24" et convertis-les :
  * "SAC 2.5KG" -> conditionnement:2.5, unite:"kg"
  * "500G" -> conditionnement:0.5, unite:"kg"
  * "10X125G" -> conditionnement:1.25, unite:"kg" (10 x 125g = 1.25kg), sauf si le produit se vend clairement à la pièce (ex: sachets individuels), auquel cas conditionnement:10, unite:"piece"
  * "1,15L" -> conditionnement:1.15, unite:"L"
  * si aucune unité de poids/volume n'est mentionnée (ex: ustensiles, emballages), utilise unite:"piece" et conditionnement:1 (ou le nombre d'unités si indiqué, ex: "GN1/3" une seule pièce)

RÈGLES POUR LES MONTANTS :
- "montant_total_ht" = le total HT du document (ex: "Total H.T." ou ligne "HT" du tableau de ventilation TVA en bas de page) — jamais un sous-total intermédiaire
- "montant_total_ttc" = "Net à Payer", "Total TTC" ou "Total à payer" en bas de la dernière page
- Ignore les sous-totaux intermédiaires (ex: "<< Montant de commande HT >>", les totaux par rayon/catégorie type "*** FROMAGE Total") et le "CUMUL FACTURES" (qui inclut les factures précédentes)
- Le HT correct est toujours inférieur au TTC
- Si le produit n'a pas de poids (boites, pièces, sachets), utilise "piece" comme unite et le nombre de pièces dans le colis comme conditionnement

NUMÉRO DE FACTURE :
- Certains fournisseurs utilisent un numéro composite avec plusieurs blocs entre parenthèses (ex: "0/0(134)0055/023812 (055-042607)"). Dans ce cas, retiens le numéro complet tel qu'imprimé à côté de "N° FACTURE", sans le tronquer ni n'en garder qu'une partie.

EXEMPLES :
- "MIX MOZZA 1kg, quantite=10, prix=5.80" -> quantite:10, conditionnement:1, unite:"kg"
- "ORANGE 15kg, quantite=2, prix=1.50" -> quantite:2, conditionnement:15, unite:"kg"
- "COCA COLA 33CLx24, quantite=2, prix=0.55" -> quantite:2, conditionnement:24, unite:"piece"
- "JAMBON 16 TRANCHES 30grs, quantite=4, prix=5.54" -> quantite:4, conditionnement:16, unite:"piece"
- "MOZZA 45%MG RAPE SAC 2.5KG, Prix unitaire=16.70, Qté=4, Montant=66.80" -> quantite:4, conditionnement:2.5, unite:"kg", prix_unitaire_ht:16.70, montant_ht:66.80

Si un champ est réellement introuvable ou illisible même en ignorant les surimpressions, retourne une chaîne vide "" ou 0 — n'invente jamais une valeur.
Pour un document multi-pages (plusieurs bons de livraison rattachés à une même facture), agrège toutes les lignes produits de toutes les pages, et prends les montants totaux et l'en-tête fournisseur de la page qui fait office de facture récapitulative.`

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Corrige les incohérences quantite/prix/montant (garde-fou indépendant du moteur OCR)
// Filet de sécurité déterministe (indépendant du modèle) : si le modèle renvoie un conditionnement
// de 1 (valeur par défaut probable quand il n'a pas repéré de poids/volume précis) alors que la
// désignation contient clairement un motif de poids/volume différent, on corrige automatiquement.
// On ne touche jamais à un conditionnement déjà différent de 1 pour ne pas écraser une valeur
// correcte (ex: motifs composés comme "10X125G" déjà bien résolus par le modèle en 1.25).
function extraireConditionnementDesignation(designation) {
  if (!designation) return null
  const m = designation.match(/(\d+(?:[.,]\d+)?)\s*(KG|G|ML|L)\b/i)
  if (!m) return null
  let valeur = parseFloat(m[1].replace(',', '.'))
  const unite = m[2].toUpperCase()
  if (!valeur || valeur <= 0) return null
  if (unite === 'G') return { valeur: valeur / 1000, unite: 'kg' }
  if (unite === 'ML') return { valeur: valeur / 1000, unite: 'L' }
  if (unite === 'KG') return { valeur, unite: 'kg' }
  if (unite === 'L') return { valeur, unite: 'L' }
  return null
}

function corrigerLignes(lignes) {
  if (!Array.isArray(lignes)) return []
  const vues = []
  const result = []
  for (const ligne of lignes) {
    const l = { ...ligne }
    if (l.prix_unitaire_ht > 0 && l.montant_ht > 0) {
      const quantiteCalculee = Math.round(l.montant_ht / l.prix_unitaire_ht)
      const ecart = Math.abs(quantiteCalculee - l.quantite) / (l.quantite || 1)
      if (ecart > 0.05) l.quantite = quantiteCalculee
    }

    if (!l.conditionnement || l.conditionnement === 1) {
      const detecte = extraireConditionnementDesignation(l.designation)
      if (detecte && Math.abs(detecte.valeur - 1) > 0.001) {
        l.conditionnement = detecte.valeur
        if (!l.unite) l.unite = detecte.unite
      }
    }

    // On ne supprime une ligne que si elle est STRICTEMENT identique à une ligne déjà vue
    // (même référence, même désignation, même montant, même conditionnement) — ça correspond à
    // une vraie erreur de lecture (la même ligne du tableau lue deux fois par l'OCR).
    // Des lignes qui partagent juste la référence/désignation mais avec un poids ou un montant
    // différent (ex: plusieurs pièces d'un même produit pesées séparément, comme du saumon fumé
    // vendu au poids) sont des lignes distinctes et légitimes : il ne faut jamais les fusionner
    // ni en supprimer une, sous peine de perdre de la marchandise dans le calcul de stock.
    const estDoublonExact = vues.some(v =>
      v.reference === l.reference &&
      v.designation === l.designation &&
      Math.abs((v.montant_ht || 0) - (l.montant_ht || 0)) < 0.01 &&
      Math.abs((v.conditionnement || 0) - (l.conditionnement || 0)) < 0.001
    )
    if (estDoublonExact) continue

    vues.push(l)
    result.push(l)
  }
  return result
}

/**
 * Extrait les données structurées d'une facture PDF (base64, sans le préfixe data:...).
 * Retourne { extracted, needsReview, confidence, rawText }.
 * - extracted : les données structurées (peut être partiellement vide si l'OCR n'a rien trouvé)
 * - needsReview : true si l'extraction est probablement incomplète/ratée (à signaler à l'utilisateur)
 * - confidence : score moyen de confiance de l'OCR sur le document (0-1), ou null si indisponible
 * - rawText : le texte brut (markdown) lu par l'OCR, utile en secours si l'extraction structurée échoue
 */
export async function extractInvoiceData(base64Pdf) {
  const response = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: {
        type: 'document_url',
        document_url: `data:application/pdf;base64,${base64Pdf}`
      },
      document_annotation_format: INVOICE_SCHEMA,
      document_annotation_prompt: ANNOTATION_PROMPT,
      confidence_scores_granularity: 'page',
      include_image_base64: false
    })
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Erreur API OCR Mistral (${response.status}): ${errText}`)
  }

  const data = await response.json()

  const rawText = (data.pages || []).map(p => p.markdown || '').join('\n\n')

  const confidences = (data.pages || [])
    .map(p => p.confidence_scores?.average_page_confidence_score)
    .filter(c => typeof c === 'number')
  const confidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : null

  let extracted = null
  let parseFailed = false
  try {
    extracted = JSON.parse(data.document_annotation)
    extracted.lignes = corrigerLignes(extracted.lignes)
  } catch (e) {
    parseFailed = true
    extracted = { fournisseur: {}, facture: {}, lignes: [] }
  }

  const champsClesManquants =
    !extracted.fournisseur?.nom &&
    !extracted.facture?.montant_total_ttc &&
    (!extracted.lignes || extracted.lignes.length === 0)

  const confianceFaible = confidence !== null && confidence < 0.6

  const needsReview = parseFailed || champsClesManquants || confianceFaible

  return { extracted, needsReview, confidence, rawText }
}

export { fileToBase64 }
