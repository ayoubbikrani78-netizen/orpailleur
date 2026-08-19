// ============================================================
// Suggestion de catégorie (Univers/Famille) en masse, pour les articles
// Mercuriale déjà créés mais restés non catégorisés (ex: import fait
// avant que le référentiel de catégories ne soit en place). Même
// taxonomie et même prudence que la suggestion faite à l'import facture :
// une SUGGESTION à valider, jamais appliquée automatiquement en aveugle.
// ============================================================

const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY

const CATEGORIES_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'suggestions_categories',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        lignes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              designation: { type: 'string' },
              univers_suggere: { type: 'string' },
              famille_suggere: { type: 'string' }
            },
            required: ['designation', 'univers_suggere', 'famille_suggere']
          }
        }
      },
      required: ['lignes']
    }
  }
}

const CATEGORIES_PROMPT = `Tu catégorises des matières premières de boulangerie-pâtisserie selon une segmentation inspirée des rayons de grande surface.
Pour CHAQUE désignation reçue (une par ligne), renvoie exactement la même désignation telle quelle, avec une catégorie et une sous-catégorie suggérées.
Reste strictement dans la liste ci-dessous ; n'invente pas de nouvelle catégorie. Si tu hésites vraiment, choisis la plus probable plutôt que de laisser vide ; ne laisse vide ("") que si aucune catégorie ne correspond. Ne catégorise jamais un produit visiblement fabriqué en interne (ex: "PRALINE ... MAISON") — laisse vide dans ce cas.

Catégories disponibles et leurs sous-catégories :
- Boissons : Café & thé, Eaux, Jus & nectars, Sirops, Sodas, Énergisants
- Consommables : Jetables, Nettoyage, Papeterie caisse, Ustensiles pâtisserie
- Crèmerie : Beurre, Crèmes, Fromages, Lait, Œufs
- Fruits & Légumes frais : Fruits frais, Légumes frais
- Fruits secs & oléagineux : Fruits séchés, Oléagineux
- Meunerie : Farines, Graines, Mix & améliorants pain
- Surgelés : Fruits surgelés, Pâtisserie surgelée, Snacking surgelé, Viennoiserie surgelée
- Traiteur / Snacking salé : Charcuterie, Fromages snacking, Pizza, Poissons, Sauces & condiments traiteur
- Épicerie : Condiments & assaisonnements, Conserves, Huiles
- Épicerie sucrée : Additifs & texturants, Arômes & colorants, Chocolat & cacao, Décors & finitions, Sucres & édulcorants`

/**
 * Envoie un lot de désignations à l'IA et retourne les suggestions.
 * Toujours par lots de 60 maximum, pour rester dans une réponse fiable.
 */
export async function suggererCategoriesEnMasse(designations) {
  const lots = []
  for (let i = 0; i < designations.length; i += 60) lots.push(designations.slice(i, i + 60))

  const resultats = []
  for (const lot of lots) {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral-large-latest',
        messages: [
          { role: 'system', content: CATEGORIES_PROMPT },
          { role: 'user', content: lot.join('\n') }
        ],
        response_format: CATEGORIES_SCHEMA
      })
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`Erreur API Mistral (${response.status}): ${errText}`)
    }
    const data = await response.json()
    let brut
    try {
      brut = JSON.parse(data.choices?.[0]?.message?.content)
    } catch {
      throw new Error("L'IA n'a pas renvoyé un format exploitable. Réessaie.")
    }
    resultats.push(...(brut.lignes || []))
  }
  return resultats
}
