const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY

export async function extractInvoiceData(base64PDF) {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Tu es un expert en lecture de factures fournisseurs pour une boulangerie. 
              Extrais les informations suivantes de cette facture et retourne UNIQUEMENT un JSON valide sans aucun texte autour :
              {
                "fournisseur": {
                  "nom": "",
                  "adresse": "",
                  "telephone": "",
                  "email": "",
                  "siret": "",
                  "siren": ""
                },
                "facture": {
                  "numero": "",
                  "date": "",
                  "montant_total_ht": 0,
                  "montant_total_ttc": 0
                },
                "lignes": [
                  {
                    "reference": "",
                    "designation": "",
                    "conditionnement": 0,
                    "unite": "",
                    "prix_unitaire_ht": 0,
                    "quantite": 0,
                    "montant_ht": 0
                  }
                ]
              }`
            },
            {
              type: 'image_url',
              image_url: `data:application/pdf;base64,${base64PDF}`
            }
          ]
        }
      ]
    })
  })

  const data = await response.json()
  const content = data.choices[0].message.content
  return JSON.parse(content)
}