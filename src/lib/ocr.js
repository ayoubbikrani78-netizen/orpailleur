// Module OCR partagé — utilisé par Factures.jsx et Reception.jsx
//
// ARCHITECTURE (v2, reconstruite après 10 jours d'itérations sur des cas réels) :
// Le modèle ne fait plus AUCUN calcul. Il transcrit littéralement ce qui est imprimé sur la facture
// (colonnes brutes en texte, sans interpréter les formats de nombres), et donne UNE seule information
// calculée et bornée : le poids/volume total représenté par UNE unité de la colonne quantité.
// Tout le reste — parsing des nombres (virgule/point), vérification de cohérence, calcul final du
// stock — est fait ici en JavaScript déterministe et testé unitairement (voir les fonctions
// parseNombre et parsePoidsVolume ci-dessous), plutôt que d'espérer que le modèle soit cohérent à
// chaque facture. C'est ce découplage qui manquait dans les versions précédentes : demander au
// modèle de lire ET de calculer en même temps est ce qui causait la plupart des erreurs récurrentes.

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
            montant_total_ht_brut: { type: 'string' },
            montant_total_ttc_brut: { type: 'string' }
          },
          required: ['numero', 'date', 'echeance', 'delai_paiement_jours', 'montant_total_ht_brut', 'montant_total_ttc_brut']
        },
        lignes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              designation: { type: 'string' },
              quantite_brute: { type: 'string' },
              conditionnement_colonne_brute: { type: 'string' },
              prix_unitaire_brut: { type: 'string' },
              montant_brut: { type: 'string' },
              poids_volume_par_unite: { type: 'string' }
            },
            required: ['designation', 'quantite_brute', 'conditionnement_colonne_brute', 'prix_unitaire_brut', 'montant_brut', 'poids_volume_par_unite']
          }
        }
      },
      required: ['fournisseur', 'facture', 'lignes']
    }
  }
}

const ANNOTATION_PROMPT = `Tu es un expert en lecture de factures fournisseurs pour une boulangerie française.
Ce document peut être n'importe quel type de facture (grande distribution, grossiste, artisan, meunerie, multi-pages, etc.) — adapte-toi à sa mise en page réelle.

RÈGLE LA PLUS IMPORTANTE : TU NE FAIS JAMAIS DE CALCUL. Tu transcris littéralement ce qui est imprimé, exactement caractère pour caractère, y compris les virgules et points tels qu'ils apparaissent (ex: si tu vois "1,025.00", écris exactement "1,025.00" dans le JSON, ne le convertis JAMAIS en 1025 ou 1.025 toi-même — c'est un programme séparé qui s'en charge). La seule chose que tu calcules est le champ "poids_volume_par_unite" décrit plus bas, qui reste un calcul simple et borné.

RÈGLE SUR LES SURIMPRESSIONS : si le document comporte un filigrane ou tampon ("DUPLICATA", "COPIE"...), ignore-le et lis le texte imprimé original en dessous.

=== FOURNISSEUR ET FACTURE ===
- "numero" : le numéro de facture complet tel qu'imprimé à côté de "N° FACTURE" ou équivalent, sans le tronquer, même s'il est composite (plusieurs blocs entre parenthèses).
- "montant_total_ht_brut" et "montant_total_ttc_brut" : recopie exactement le texte des montants totaux (Total HT / Net à Payer / Total TTC), avec la ponctuation d'origine. Si la facture a plusieurs taux de TVA (plusieurs lignes dans un tableau "VENTILATION TVA"), cherche en priorité une ligne de total déjà additionnée ; si tu ne la trouves pas, indique la somme des lignes de HT sous forme de texte numérique (ex: si 25,94 et 633,30, écris "659.24" ou "659,24").
- Si un champ est introuvable, retourne une chaîne vide "" — n'invente jamais de valeur.

=== LIGNES PRODUITS : transcription brute des colonnes ===
Pour chaque ligne du tableau de produits :
- "designation" : le nom du produit uniquement (première ligne de texte de la cellule si plusieurs infos y sont empilées — ignore les mentions de ristourne/remise/note qualité empilées en dessous, ne les traite jamais comme des lignes séparées). Attention : si une NOUVELLE ligne du tableau commence avec sa propre valeur de quantité (même si c'est de nouveau "1"), c'est une ligne PRODUIT distincte, même si elle suit immédiatement une autre ligne — ne l'avale jamais dans la ligne précédente.

EXEMPLE CONCRET (cellule empilée à gérer correctement) : une ligne de tableau affiche, empilés dans la même cellule Désignation : "SENONE-25 kg" / "RISTOURNE POUR PAIEMENT RAPIDE" / "RISTOURNE EXCEPTIONNELLE" / "** PRIX UNITAIRE NET" / "Farine Label Rouge issue de blé CRC", avec Nombre sacs=10, Nombre tonnes=0.250, et dans la colonne Prix unitaire empilée : "1,060.00" / "42.50" / "277.50" / "740.00", Montant H.T.=185.00. Ceci doit produire UNE seule ligne : designation="SENONE-25 kg", quantite_brute="10", prix_unitaire_brut="740.00" (le prix net, dernière valeur empilée), montant_brut="185.00", poids_volume_par_unite="25kg" (25kg par sac). N'oublie pas cette ligne : c'est souvent la plus grosse ligne de la facture, et la présence de plusieurs mentions empilées ne doit jamais te faire l'ignorer ou la fusionner avec autre chose.
- "quantite_brute" : le nombre de la colonne quantité/nombre de sacs/nombre de colis achetés, tel qu'imprimé (en texte).
- "conditionnement_colonne_brute" : si une colonne séparée "Cond'"/"Conditionnement"/"Colisage" existe, son nombre tel qu'imprimé. Sinon "".
- "prix_unitaire_brut" : le prix unitaire NET tel qu'imprimé. Si plusieurs valeurs sont empilées dans cette cellule (prix de base, ristourne(s), puis prix net — souvent précédé de "** PRIX UNITAIRE NET"), prends UNIQUEMENT la dernière (le prix net), jamais le prix de base ni les ristournes.
- "montant_brut" : le montant HT de cette ligne, tel qu'imprimé dans la colonne Montant/Montant H.T. — jamais une des valeurs empilées de la colonne prix, jamais un sous-total de catégorie.
- N'inclus JAMAIS dans "lignes" les lignes de frais/remise/ajustement qui ne sont pas des produits physiques : frais de transport/port, remises, ristournes, escomptes, acomptes, annulations, arrhes.

=== LE CHAMP "poids_volume_par_unite" (le seul calcul demandé) ===
Réponds à cette question précise : "si j'achète UNE unité de la colonne quantité (un sac, un colis, un carton...), quel poids ou volume total cela représente-t-il ?" Donne la réponse sous forme de texte avec unité collée, ex: "2.5kg", "0.48kg", "25kg", "7.92L", "100piece". Si le produit n'a aucun poids/volume pertinent (fleurs décoratives, ustensiles, emballages sans poids donné), écris "1piece".

FORMULE À APPLIQUER : poids_volume_par_unite = (valeur de la colonne Colisage/Cond', si elle existe et représente un nombre de sous-unités par colis — sinon 1) × (poids ou volume d'UNE sous-unité de base, tel qu'indiqué dans la désignation ou le nom du produit).

Exemples concrets avec le detail du calcul :
- "MOZZA 45%MG RAPE SAC 2.5KG", Colisage=1 (ou absent), désignation indique 2.5kg par sac -> poids_volume_par_unite = 1 × 2.5kg = "2.5kg"
- "OEUF LIQ. JAUNE BD 2KG OVOTEAM", Colisage=2 (2 briques par carton), désignation indique 2kg par brique -> poids_volume_par_unite = 2 × 2kg = "4kg" (PAS "2kg" — il faut multiplier par le Colisage)
- "COCA COLA 33CLx24 BOITES", Colisage=24 (24 bouteilles par carton) -> poids_volume_par_unite = "24piece" (un carton de boissons vendu tel quel : compte par pièce, pas par volume — voir remarque ci-dessous)
- "CREME UHT 35% 12x1L", Colisage=12 (12 briques par carton) -> poids_volume_par_unite = "12piece" (idem : par défaut en pièces)

REMARQUE IMPORTANTE sur les cartons contenant plusieurs bouteilles/briques : par défaut, compte-les en pièces (comme ci-dessus), même si chacune a un volume connu. La décision "ce produit doit être suivi au volume (mL/L) plutôt qu'en pièces" dépend de l'usage qu'en fait le boulanger (ingrédient de recette pesé/mesuré, vs produit revendu tel quel) — une information que la facture ne donne jamais. Cette décision sera prise une fois, manuellement, dans la fiche article. Ne convertis en kg/L automatiquement QUE pour les cas sans ambiguïté : un seul contenant avec son propre poids/volume (sac de farine, bidon, barquette), une boîte de conserve, des tranches — jamais pour un carton de plusieurs bouteilles/briques identiques.
- "MPRO 25BTE HERMETIQUE 1,15L", Colisage=25 (25 boîtes par carton), désignation indique 1.15L par boîte -> poids_volume_par_unite = 25 × 1.15L = "28.75L"
- "JAMBON DE DINDE HALAL 16 TRANCHE 30grs", Colisage=1 (ou absent), désignation indique 16 tranches de 30g -> poids_volume_par_unite = 1 × (16 × 30g) = "0.48kg"

RÈGLE SUR LES PRODUITS DE VIENNOISERIE/BOULANGERIE PRÊTS À VENDRE (motif "poids x nombre", ex: "75gx144", "130g X90", "120gx60") : sur des produits achetés déjà fabriqués pour être revendus TELS QUELS (croissants, pains au chocolat, chaussons, brioches, viennoiseries surgelées...), jamais transformés dans une recette, ce motif indique le poids d'UNE pièce (avant le x) et le NOMBRE DE PIÈCES par carton (après le x) — ce n'est PAS un poids total à calculer. Le suivi se fait en NOMBRE DE PIÈCES, pas en kg :
- "CROISSANT SECRETS 75gx144", Qté=5 cartons -> poids_volume_par_unite = "144piece" (PAS "10.8kg") — total = 5 × 144 = 720 pièces
- "PAIN RAISINS BF ECLAT du TERROIR130g X90", Qté=2 cartons -> poids_volume_par_unite = "90piece" (PAS un poids) — total = 2 × 90 = 180 pièces
Ne confonds pas avec un ingrédient brut destiné à être transformé (farine, jambon en tranches, fromage...), qui reste suivi au poids comme les autres exemples ci-dessus.
- Comptage d'unités non pesables (ex: "20u x 5" = 100 unités, "Paquet 125 sachets", "EN 1000 FEUILLES") : donne le total en pièces ("100piece", "125piece", "1000piece").
- Code de format de boîte de conserve professionnel type "3/1", "5/1" (le chiffre avant "/1" ≈ poids net en kg, convention du métier) : "3/1" -> "3kg". Un format "4/4" ou similaire n'est PAS cette convention : s'il n'y a aucune autre indication de poids, réponds "1piece".
- Attention aux nombres qui décrivent une CONTENANCE d'un contenant plutôt qu'une quantité de produit achetée : ex. "SACS POUBELLES 130L" (sacs conçus pour contenir 130 litres de déchets, pas 130L de produit), "BAC RECT 20L 53X40 H14CM" (un bac de rangement d'une contenance de 20L — tu achètes des bacs vides, pas 20L de quelque chose), "SEAU 5L" quand c'est le nom d'un contenant vide vendu comme ustensile. Dans ces cas, ignore ce nombre et réponds "1piece" par bac/contenant acheté (ou le comptage d'unités s'il y en a un, ex: "20u x 5" -> "100piece"). Ne confonds jamais la contenance d'un contenant avec le poids/volume d'un produit alimentaire conditionné dedans (ex: "OEUF ENTIER LIQUIDE BIB 5L" est bien 5L de produit, car c'est un aliment liquide vendu par le volume — la distinction se fait sur si le nom désigne un ustensile/contenant vide ou un aliment).`

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ---------------------------------------------------------------------------
// Parsing déterministe des nombres (virgule/point). Testé contre tous les cas
// réels rencontrés : "1,025.00" (anglo-saxon, milliers) -> 1025 ; "24,100" ou
// "72,30" (français, décimale) -> 24.1 / 72.3 ; "1.234,56" -> 1234.56.
// Règle : le séparateur le plus à DROITE dans la chaîne est la décimale ; l'autre,
// s'il existe, est un séparateur de milliers à retirer.
// ---------------------------------------------------------------------------
export function parseNombre(brut) {
  if (typeof brut === 'number') return brut
  if (brut === null || brut === undefined) return 0
  let s = String(brut).trim().replace(/\s/g, '').replace(/€/g, '')
  if (!s) return 0
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma === -1 && lastDot === -1) return parseFloat(s) || 0
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  return parseFloat(s) || 0
}

// ---------------------------------------------------------------------------
// Parsing du champ "poids_volume_par_unite" renvoyé par le modèle (ex: "2.5kg",
// "0.48kg", "7.92L", "100piece") en { valeur, unite }.
// ---------------------------------------------------------------------------
export function parsePoidsVolume(texte) {
  if (!texte) return null
  const s = String(texte).trim().replace(',', '.')
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(KG|G|ML|L|PIECE|PIECES|PIÈCE|PIÈCES)$/i)
  if (!m) return null
  const valeur = parseFloat(m[1])
  if (!(valeur > 0)) return null
  const unite = m[2].toUpperCase()
  if (unite === 'KG') return { valeur, unite: 'kg' }
  if (unite === 'G') return { valeur: valeur / 1000, unite: 'kg' }
  if (unite === 'L') return { valeur, unite: 'L' }
  if (unite === 'ML') return { valeur: valeur / 1000, unite: 'L' }
  return { valeur, unite: 'piece' }
}

// Filet de sécurité déterministe : lignes de frais/remise/ajustement à exclure même si le
// modèle les a quand même incluses par erreur.
const MOTS_CLES_NON_PRODUIT = /FRAIS DE (TRANSPORT|PORT)|RISTOURNE|REMISE|ESCOMPTE|ACOMPTE|ANNULATION|ARRHES/i

// ---------------------------------------------------------------------------
// Calcul final déterministe d'une ligne à partir des champs bruts transcrits par le modèle.
// C'est ici, et non dans le modèle, que se fait toute l'arithmétique — donc testable.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Filet de sécurité déterministe, indépendant du modèle : détecte un poids/volume/comptage
// explicite dans la désignation. Réintégré après avoir constaté que le modèle seul est
// incohérent sur ce calcul (juste sur une facture, faux sur une autre pour un produit quasi
// identique) — on ne peut pas s'y fier à 100%, donc on garde un filet déterministe en secours.
// ---------------------------------------------------------------------------
function detecterPoidsVolumeTexte(designation) {
  if (!designation) return null
  const packMultiple = designation.match(/(\d+)\s*u\s*x\s*(\d+)/i)
  if (packMultiple) {
    const total = parseFloat(packMultiple[1]) * parseFloat(packMultiple[2])
    if (total > 0) return { valeur: total, unite: 'piece' }
  }
  const comptage = designation.match(/(\d+)\s*(FEUILLES?|SACHETS?|UNITES?|UNITÉS?|PIECES?|PIÈCES?|PC)\b/i)
  if (comptage) {
    const valeur = parseFloat(comptage[1])
    if (valeur > 0) return { valeur, unite: 'piece' }
  }
  // Comptage en toute fin de désignation après CARTON/BOITE (ex: "OEUF ... CARTON 360" = 360 œufs)
  const cartonCount = designation.match(/\b(CARTON|BOITE|BOÎTE|COLIS)\s+(\d+)$/i)
  if (cartonCount) {
    const valeur = parseFloat(cartonCount[2])
    if (valeur > 0) return { valeur, unite: 'piece' }
  }
  // Motif composé "poids unitaire x grand nombre" (ex: "75gx144", "130g X90", "120gx60") géré
  // séparément dans detecterMotifCompose ci-dessous : ce motif s'est montré tellement peu fiable
  // pour le modèle (il ne renvoie que le petit poids unitaire, sans le multiplier) qu'on l'applique
  // TOUJOURS, même quand le modèle a déjà répondu autre chose que la valeur par défaut.
  const m = designation.match(/(\d+(?:[.,]\d+)?)\s*(KG|GRS|GRAMMES|GR|G|ML|CL|L)\b/i)
  if (m) {
    let valeur = parseFloat(m[1].replace(',', '.'))
    const unite = m[2].toUpperCase()
    if (valeur > 0) {
      if (unite === 'G' || unite === 'GR' || unite === 'GRS' || unite === 'GRAMMES') return { valeur: valeur / 1000, unite: 'kg' }
      if (unite === 'ML') return { valeur: valeur / 1000, unite: 'L' }
      if (unite === 'CL') return { valeur: valeur / 100, unite: 'L' }
      if (unite === 'KG') return { valeur, unite: 'kg' }
      if (unite === 'L') return { valeur, unite: 'L' }
    }
  }
  const boite = designation.match(/(?<!\d)(\d{1,2})\/1\b/)
  if (boite) {
    const valeur = parseFloat(boite[1])
    if (valeur > 0 && valeur <= 20) return { valeur, unite: 'kg' }
  }
  return null
}

// Motif composé "poids unitaire x grand nombre" (ex: "75gx144", "130g X90", "120gx60") : un poids
// par pièce multiplié par un nombre de pièces par carton. Ce motif s'est montré peu fiable pour le
// modèle (il renvoie souvent le petit poids unitaire seul, sans le multiplier) — on l'applique donc
// TOUJOURS quand il est présent, indépendamment de ce que le modèle a répondu.
// Mots-clés identifiant un produit de viennoiserie/boulangerie fini, revendu tel quel (jamais
// transformé) — seuls ces produits interprètent "poids x nombre" comme un comptage de pièces.
// Un ingrédient générique (viande, charcuterie...) utilisant la même structure textuelle
// ("1kgx5") reste suivi au poids total, comme avant.
const MOTS_CLES_VIENNOISERIE = /\b(CROISSANT|PAIN|CHAUSSON|BRIOCHE|VIENNOISERIE|PAIN CHOCOLAT|PAIN RAISIN)/i

function detecterMotifCompose(designation) {
  if (!designation) return null
  // Motif "poids x compte" (ex: "75gx144", "130g X90", "120gx60")
  const m = designation.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\s*[xX]\s*(\d+)\b/i)
  if (!m) return null
  const nombre = parseFloat(m[3])
  if (nombre <= 0) return null

  if (MOTS_CLES_VIENNOISERIE.test(designation)) {
    // Produit de viennoiserie/boulangerie prêt à vendre : le poids d'UNE pièce (avant le x) et le
    // NOMBRE DE PIÈCES par carton (après le x) — on suit le comptage, pas un poids total calculé.
    // Acheter 3 cartons de "130g X90" donne 3 × 90 = 270 pièces, pas un poids en kg.
    return { valeur: nombre, unite: 'piece' }
  }

  // Sinon (ingrédient générique, ex: "EMINCE POULET ROTI HALAL MDD 1kgx5") : poids total classique.
  let poidsUnitaire = parseFloat(m[1].replace(',', '.'))
  if (m[2].toLowerCase() === 'g') poidsUnitaire = poidsUnitaire / 1000
  return { valeur: Math.round(poidsUnitaire * nombre * 1000) / 1000, unite: 'kg' }
}
function detecterMotifComposeInverse(designation) {
  if (!designation) return null
  // Motif "compte x poids" (ordre inverse, ex: "30X500g", "6X125g") — restreint au poids (kg/g)
  // uniquement, jamais au volume (L/mL) : un carton de plusieurs bouteilles/briques (ex: "12x1L")
  // doit rester en pièce par défaut (décision volontaire, l'usage recette vs revente ne se devine
  // pas depuis la facture), alors qu'un sachet de poudre/levure en plusieurs unités (ex: "30X500g")
  // est presque toujours un ingrédient à suivre au poids.
  const m = designation.match(/(?<![.,\d])(\d+)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i)
  if (!m) return null
  const nombre = parseFloat(m[1])
  let poidsUnitaire = parseFloat(m[2].replace(',', '.'))
  if (m[3].toLowerCase() === 'g') poidsUnitaire = poidsUnitaire / 1000
  if (nombre > 0 && poidsUnitaire > 0) {
    return { valeur: Math.round(nombre * poidsUnitaire * 1000) / 1000, unite: 'kg' }
  }
  return null
}

export function finaliserLigne(ligneBrute) {
  const designation = ligneBrute.designation || ''
  const quantiteColonne = parseNombre(ligneBrute.quantite_brute)
  const conditionnementColonne = parseNombre(ligneBrute.conditionnement_colonne_brute) || 1
  const prixUnitaire = parseNombre(ligneBrute.prix_unitaire_brut)
  const montant = parseNombre(ligneBrute.montant_brut)

  // Vérification de cohérence sur les valeurs BRUTES de la facture (indépendante de toute
  // conversion en kg/L) : montant ≈ prix_unitaire × conditionnement_colonne × quantite.
  // On ne corrige jamais vers 0 (une ligne facturée avec un montant positif correspond
  // toujours à au moins 1 unité achetée).
  let quantite = quantiteColonne
  if (prixUnitaire > 0 && montant > 0 && conditionnementColonne > 0) {
    const quantiteCalculee = Math.round(montant / (prixUnitaire * conditionnementColonne))
    const ecart = Math.abs(quantiteCalculee - quantite) / (quantite || 1)
    if (ecart > 0.05 && quantiteCalculee >= 1) quantite = quantiteCalculee
  }

  // Poids/volume total pour une unité achetée (indépendant de conditionnementColonne, qui ne
  // sert qu'à la vérification ci-dessus) : normalement calculé par le modèle, mais on ne lui fait
  // pas une confiance aveugle.
  let poidsVolume = parsePoidsVolume(ligneBrute.poids_volume_par_unite) || { valeur: 1, unite: 'piece' }

  // Filet de sécurité n°1 (prioritaire, toujours vérifié) : motif "poids x grand nombre" composé
  // (ex: "75gx144"), peu fiable pour le modèle quelle que soit sa réponse.
  const motifCompose = detecterMotifCompose(designation)
  if (motifCompose) poidsVolume = motifCompose

  // Filet de sécurité n°1bis : motif inverse "compte x poids" (ex: "30X500g"). Déclenché dès que
  // l'unité actuelle est "piece", peu importe la valeur numérique : le modèle a pu recopier la
  // colonne Cond' telle quelle (ex: 15) sans reconnaître le poids caché dans la désignation.
  if (poidsVolume.unite === 'piece') {
    const inverse = detecterMotifComposeInverse(designation)
    if (inverse) poidsVolume = inverse
  }

  // Filet de sécurité n°2 : si le modèle est resté sur la valeur par défaut "1 pièce" (suspecte)
  // alors que la désignation contient clairement un poids/volume/comptage, on fait confiance à la
  // détection déterministe plutôt qu'au modèle.
  if (poidsVolume.unite === 'piece' && poidsVolume.valeur === 1) {
    const detecte = detecterPoidsVolumeTexte(designation)
    if (detecte) poidsVolume = detecte
  }

  // Filet de sécurité n°3 : un motif "N/M" où M != 1 (ex: "4/4") n'est PAS un code de conserve
  // valide (seul "N/1" en est un). Si le modèle a quand même converti en kg à partir du premier
  // chiffre (erreur constatée), on annule cette conversion et on repasse en pièce.
  const motifFraction = designation.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/)
  if (motifFraction && motifFraction[2] !== '1' && poidsVolume.unite === 'kg' && Math.abs(poidsVolume.valeur - parseFloat(motifFraction[1])) < 0.01) {
    poidsVolume = { valeur: 1, unite: 'piece' }
  }

  return {
    designation,
    reference: ligneBrute.reference || '',
    quantite,
    conditionnement: poidsVolume.valeur,
    unite: poidsVolume.unite,
    prix_unitaire_ht: prixUnitaire,
    montant_ht: montant
  }
}

function corrigerLignes(lignesBrutes) {
  if (!Array.isArray(lignesBrutes)) return []
  const result = []
  for (const ligneBrute of lignesBrutes) {
    if (MOTS_CLES_NON_PRODUIT.test(ligneBrute.designation || '')) continue
    if (!ligneBrute.designation) continue
    result.push(finaliserLigne(ligneBrute))
  }
  return result
}

/**
 * Extrait les données structurées d'une facture PDF (base64, sans le préfixe data:...).
 * Retourne { extracted, needsReview, confidence, rawText }.
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

  let brut = null
  let parseFailed = false
  try {
    brut = JSON.parse(data.document_annotation)
  } catch (e) {
    parseFailed = true
    brut = { fournisseur: {}, facture: {}, lignes: [] }
  }

  console.log('OCR — données brutes transcrites par le modèle (pour diagnostic) :', JSON.parse(JSON.stringify(brut)))

  const extracted = {
    fournisseur: brut.fournisseur || {},
    facture: {
      numero: brut.facture?.numero || '',
      date: brut.facture?.date || '',
      echeance: brut.facture?.echeance || '',
      delai_paiement_jours: brut.facture?.delai_paiement_jours || 0,
      montant_total_ht: parseNombre(brut.facture?.montant_total_ht_brut),
      montant_total_ttc: parseNombre(brut.facture?.montant_total_ttc_brut)
    },
    lignes: corrigerLignes(brut.lignes)
  }

  console.log('OCR — lignes après calcul déterministe :', extracted.lignes)

  const champsClesManquants =
    !extracted.fournisseur?.nom &&
    !extracted.facture?.montant_total_ttc &&
    (!extracted.lignes || extracted.lignes.length === 0)

  const confianceFaible = confidence !== null && confidence < 0.6

  const needsReview = parseFailed || champsClesManquants || confianceFaible

  return { extracted, needsReview, confidence, rawText }
}

export { fileToBase64 }
