// Module OCR partagé — utilisé par Factures.jsx et Reception.jsx
//
// ARCHITECTURE v3 (réécriture complète après diagnostic sur 8 factures réelles de 3
// fournisseurs) :
//
// Le modèle continue de NE FAIRE AUCUN calcul final — toute l'arithmétique reste en JS,
// déterministe et testable (voir parseNombre / finaliserLigne ci-dessous). Ce qui change par
// rapport à la v2 : on force le modèle à RAISONNER avant de trancher, pas à vérifier après coup.
//
// Pourquoi ce changement : la vérification a posteriori "montant ≈ quantité × conditionnement ×
// prix" ne peut PAS détecter une inversion entre la colonne Quantité et la colonne
// Conditionnement — la multiplication étant commutative, le total reste cohérent quel que soit
// le sens de l'inversion. Ce cas s'est produit sur une vraie facture (voir le piège documenté
// dans ANALYSE_LIBRE_PROMPT ci-dessous) : le texte d'en-tête du tableau, tel qu'extrait par l'OCR,
// ne respecte pas forcément l'ordre réel des colonnes.
//
// La correction structurelle : dans une sortie JSON structurée, les champs sont générés dans
// l'ordre du schéma, de façon strictement séquentielle (pas de retour en arrière possible une
// fois un champ écrit). On exploite ça en forçant, AVANT les champs numériques finaux :
//   1. une transcription brute complète de la ligne (ancrage sur ce qui est réellement imprimé)
//   2. une classification explicite du type de ligne (produit / frais / sous-total / rupture
//      non livrée / texte libre) — remplace la détection a posteriori par mots-clés comme
//      défense principale (le filet par mots-clés reste en secours, cf. MOTS_CLES_NON_PRODUIT)
//   3. une analyse en texte libre où le modèle résout la ligne comme une équation : il identifie
//      le produit et son conditionnement d'après son NOM, puis assigne les nombres de la ligne
//      en conséquence — jamais d'après la position du texte dans l'en-tête du tableau
// Ce n'est qu'après cette analyse que les champs numériques finaux sont écrits, informés par le
// raisonnement qui précède.
//
// Un filet de sécurité JS supplémentaire (finaliserLigne, "Filet n°4") détecte spécifiquement
// une inversion Cond'/Quantité résiduelle, en comparant au poids/volume détecté indépendamment
// dans la désignation — voir le commentaire sur place pour le détail du raisonnement.

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
              ligne_brute_complete: { type: 'string' },
              classification: {
                type: 'string',
                enum: ['produit', 'frais_ou_remise', 'sous_total_categorie', 'rupture_non_livree', 'texte_libre_ignorer']
              },
              analyse: { type: 'string' },
              designation: { type: 'string' },
              conditionnement_colonne_brute: { type: 'string' },
              quantite_brute: { type: 'string' },
              prix_unitaire_brut: { type: 'string' },
              montant_brut: { type: 'string' },
              poids_volume_par_unite: { type: 'string' },
              univers_suggere: { type: 'string' },
              famille_suggere: { type: 'string' }
            },
            required: [
              'ligne_brute_complete', 'classification', 'analyse', 'designation',
              'conditionnement_colonne_brute', 'quantite_brute', 'prix_unitaire_brut', 'montant_brut',
              'poids_volume_par_unite', 'univers_suggere', 'famille_suggere'
            ]
          }
        }
      },
      required: ['fournisseur', 'facture', 'lignes']
    }
  }
}

const ANALYSE_LIBRE_PROMPT = `Tu es un expert en lecture de factures fournisseurs pour une boulangerie française. Voici le texte OCR brut d'une facture, page par page, en Markdown.
Ce document peut être n'importe quel type de facture (grande distribution, grossiste, artisan, meunerie, multi-pages, etc.) — adapte-toi à sa mise en page réelle.

TA TÂCHE : analyse cette facture EN TEXTE LIBRE, comme si tu la relisais toi-même avant de la ranger. PAS de JSON, pas de format imposé ici — une formalisation séparée s'occupera de mettre tes conclusions en forme ensuite. Prends tout le temps et l'espace nécessaires : relis, compare, reviens en arrière autant que besoin AVANT de conclure sur une ligne. C'est précisément cette liberté qui doit te permettre de ne rien perdre en route, contrairement à un remplissage de formulaire ligne par ligne sans retour possible.

RÈGLE LA PLUS IMPORTANTE : NE FAIS JAMAIS DE CALCUL FINAL DE MONTANT. Recopie les nombres imprimés littéralement (mêmes virgules/points), un programme séparé s'occupe des conversions. Les seuls raisonnements attendus de ta part sont le tri des lignes et le calcul de "poids_volume_par_unite" décrit plus bas.

RÈGLE SUR LES SURIMPRESSIONS : si le document comporte un filigrane ou tampon ("DUPLICATA", "COPIE"...), ignore-le et lis le texte imprimé original en dessous.

RÈGLE SUR LE PÉRIMÈTRE DES LIGNES : ne traite comme une ligne que les LIGNES DU TABLEAU de produits/facturation. Le texte libre en dehors du tableau (instructions de livraison, coordonnées client, conditions générales, minimum de commande, mentions légales...) n'est jamais une ligne.

=== FOURNISSEUR ET FACTURE ===
Identifie clairement : nom/adresse/téléphone/email/siret/siren du fournisseur ; numéro de facture complet (même composite) ; date ; échéance ; délai de paiement en jours ; montant total HT et montant total TTC. Pour les montants totaux, recopie le texte exact (Total HT / Net à Payer / Total TTC). Si la facture a plusieurs taux de TVA, cherche en priorité une ligne de total déjà additionnée ; sinon indique la somme des lignes de HT. Si un champ est introuvable, dis-le clairement plutôt que d'inventer une valeur.

=== MÉTHODE POUR CHAQUE LIGNE DE TABLEAU (à appliquer dans cet ordre, une ligne à la fois) ===

ÉTAPE 1 — Recopie la ligne telle qu'imprimée, toutes colonnes confondues, sans interpréter ni trier. C'est ton ancrage : tu dois pouvoir répondre à toutes les étapes suivantes rien qu'en relisant ce texte.

ÉTAPE 2 — Classe la ligne dans UNE catégorie parmi :
- "produit" : une vraie ligne de marchandise achetée, avec quantité/prix/montant.
- "frais_ou_remise" : frais de transport/port, remise, ristourne, escompte, acompte, annulation, arrhes, frais d'impayé ou de rejet de prélèvement ("FRAIS IMPAYES", "REJET PRELEVEMENT"...), ou toute ligne "FRAIS ..." qui n'est pas une marchandise physique.
- "sous_total_categorie" : une ligne récapitulative intercalée AU MILIEU du tableau de produits, du type "---> TOTAL : PRODUITS FRAIS", "TOTAL PRODUITS SECS/SURGELES" — ce n'est jamais un produit, même si un montant y figure.

ERREUR À NE JAMAIS COMMETTRE (piège réel constaté, dans LES DEUX SENS) : un sous-total de catégorie ne doit JAMAIS être fusionné avec la ligne produit qui le précède, ni avec celle qui le suit. Ce sont TOUJOURS deux lignes distinctes, chacune avec ses propres valeurs — jamais les nombres d'une ligne produit voisine absorbés dans le sous-total, jamais l'inverse.
Cas n°1 (le produit AVANT disparaît) : la cellule contient à la suite "TARTINABLE PHILADELPHIA NATURE 1.650KG / Qte=4 DLC=05/08/2026 Lot Frs=OFA1360653 / ---> TOTAL : PRODUITS FRAIS" avec les nombres "1,65 4 10,932 72,15" juste avant le total. Il faut identifier DEUX lignes : (1) TARTINABLE PHILADELPHIA NATURE 1.650KG, produit, conditionnement 1,65, quantité 4, prix 10,932, montant 72,15 ; (2) TOTAL : PRODUITS FRAIS, sous-total, sans autre valeur.
Cas n°2 (le montant du total contamine le produit APRÈS) : la cellule contient "---> TOTAL : PRODUITS FRAIS 437,04" puis juste en dessous "EXTRAIT VANILLE TAHITENSIS GRAINS 500G 1 5 41,619 208,10". Le montant "437,04" appartient UNIQUEMENT au sous-total. EXTRAIT VANILLE a son propre montant, "208,10", qui ne doit jamais être remplacé par celui du sous-total voisin.
Règle générale : avant de conclure sur une ligne "sous_total_categorie" ou "produit", relis le texte brut et vérifie qu'aucun nombre appartenant à une ligne n'a été attribué à l'autre. C'est l'erreur la plus fréquente constatée jusqu'ici — sois particulièrement vigilant à chaque fois qu'un "TOTAL :" apparaît au milieu du tableau.
- "rupture_non_livree" : une ligne commandée mais explicitement marquée comme non livrée (mot "Manquant" ou équivalent à la place du prix/montant), même si une quantité commandée est indiquée à côté.
- "texte_libre_ignorer" : une ligne de tableau qui ne contient en réalité que du texte informatif sans donnée chiffrée exploitable.
Seules les lignes "produit" seront conservées après traitement — classe soigneusement, ne classe jamais un vrai produit ailleurs juste par doute, et inversement ne classe jamais en "produit" une ligne de frais ou un sous-total.

ÉTAPE 3 — résous la ligne comme une équation, pas comme des cases à remplir indépendamment. Explique ton raisonnement en quelques phrases.
D'abord, identifie ce qu'est le produit et son conditionnement D'APRÈS SON NOM (pas d'après la position des colonnes) : si le nom annonce un poids/volume précis (ex: "3kg", "10kg", "BIB 5L", "SAC 2.5KG"), c'est ce nombre qui doit correspondre au conditionnement.
Ensuite, assigne les nombres de la ligne aux bons champs en vérifiant que quantité × conditionnement × prix ≈ montant, ET que la valeur assignée au conditionnement correspond bien au poids/volume identifié dans le nom.

PIÈGE RÉEL À CONNAÎTRE (ne jamais s'y faire prendre) : sur certains formats de facture, le texte de l'en-tête du tableau, tel qu'extrait, ne respecte PAS l'ordre réel des colonnes imprimées (colonnes empilées sur plusieurs lignes de texte lors de l'extraction). Exemple vécu : une ligne affiche la désignation "FOURRAGE CROQUANT MANGUE PASSION 3kg", puis les nombres "3,00" et "1", puis un prix "24,100" et un montant "72,30". Le nom annonce "3kg" → c'est le "3,00" qui est le CONDITIONNEMENT (poids d'un sac), le "1" est la QUANTITÉ (1 sac commandé) — même si l'en-tête du tableau semblait suggérer l'ordre inverse. Ne te fie JAMAIS à la position du texte d'en-tête pour décider quel nombre est la quantité et lequel est le conditionnement : fie-toi uniquement à la correspondance avec le nom du produit, complétée par la vérification quantité × conditionnement × prix ≈ montant.

ÉTAPE 4 — conclus clairement sur les valeurs suivantes (elles seront reprises telles quelles à l'étape de formalisation, donc énonce-les sans ambiguïté) :
- "designation" : le nom du produit uniquement (première ligne de texte de la cellule si plusieurs infos y sont empilées). Deux types de sous-lignes empilées à absorber SANS jamais les traiter comme des lignes séparées :
  (a) mentions de ristourne/remise/note qualité (ex: "RISTOURNE POUR PAIEMENT RAPIDE", "** PRIX UNITAIRE NET") — voir l'exemple SENONE ci-dessous ;
  (b) mentions de traçabilité produit (ex: "Qte=10 DLC=18/06/2026 Lot Frs=N6080109111") — fréquentes sur certains formats, une ligne de ce type sous chaque désignation, jamais un produit distinct.
  Attention : si une NOUVELLE ligne du tableau commence avec sa propre valeur de quantité (même si c'est de nouveau "1"), c'est une ligne PRODUIT distincte, même si elle suit immédiatement une autre ligne — ne l'avale jamais dans la ligne précédente.

EXEMPLE CONCRET (cellule empilée à gérer correctement) : une ligne de tableau affiche, empilés dans la même cellule Désignation : "SENONE-25 kg" / "RISTOURNE POUR PAIEMENT RAPIDE" / "RISTOURNE EXCEPTIONNELLE" / "** PRIX UNITAIRE NET" / "Farine Label Rouge issue de blé CRC", avec Nombre sacs=10, Nombre tonnes=0.250, et dans la colonne Prix unitaire empilée : "1,060.00" / "42.50" / "277.50" / "740.00", Montant H.T.=185.00. Ceci doit produire UNE seule ligne "produit" : designation="SENONE-25 kg", quantite_brute="10", prix_unitaire_brut="740.00" (le prix net, dernière valeur empilée), montant_brut="185.00", poids_volume_par_unite="25kg" (25kg par sac). N'oublie pas cette ligne : c'est souvent la plus grosse ligne de la facture.

- "quantite_brute" et "conditionnement_colonne_brute" : les deux nombres identifiés à l'étape 3, tels qu'imprimés (en texte). Si une seule colonne quantité existe (pas de colonne Cond' séparée), laisse "conditionnement_colonne_brute" à "".
- "prix_unitaire_brut" : le prix unitaire NET tel qu'imprimé. Si plusieurs valeurs sont empilées dans cette cellule (prix de base, ristourne(s), puis prix net — souvent précédé de "** PRIX UNITAIRE NET"), prends UNIQUEMENT la dernière (le prix net), jamais le prix de base ni les ristournes.
- "montant_brut" : le montant HT de cette ligne, tel qu'imprimé dans la colonne Montant/Montant H.T. — jamais une des valeurs empilées de la colonne prix, jamais un sous-total de catégorie.
- Quantité décimale (ex: "2,414") : normal pour un produit vendu au poids réel pesé (poissonnerie, fromage à la coupe...) — ce n'est pas une anomalie, ne l'arrondis pas et ne la rejette pas.

=== LE CHAMP "poids_volume_par_unite" (le seul calcul demandé, en plus de "analyse") ===
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
- Attention aux nombres qui décrivent une CONTENANCE d'un contenant plutôt qu'une quantité de produit achetée : ex. "SACS POUBELLES 130L" (sacs conçus pour contenir 130 litres de déchets, pas 130L de produit), "BAC RECT 20L 53X40 H14CM" (un bac de rangement d'une contenance de 20L — tu achètes des bacs vides, pas 20L de quelque chose), "SEAU 5L" quand c'est le nom d'un contenant vide vendu comme ustensile. Dans ces cas, ignore ce nombre et réponds "1piece" par bac/contenant acheté (ou le comptage d'unités s'il y en a un, ex: "20u x 5" -> "100piece"). Ne confonds jamais la contenance d'un contenant avec le poids/volume d'un produit alimentaire conditionné dedans (ex: "OEUF ENTIER LIQUIDE BIB 5L" est bien 5L de produit, car c'est un aliment liquide vendu par le volume — la distinction se fait sur si le nom désigne un ustensile/contenant vide ou un aliment).

=== CATÉGORISATION (univers_suggere / famille_suggere) ===
Propose une catégorie pour chaque ligne produit, en te basant UNIQUEMENT sur son nom — c'est une suggestion que le boulanger pourra corriger, pas un calcul, donc reste dans la liste ci-dessous et n'invente pas de nouvelle catégorie. Si tu hésites vraiment entre plusieurs sous-catégories, choisis la plus probable plutôt que de laisser vide ; ne laisse vide ("") que si le produit ne correspond à aucune catégorie de la liste. Ne catégorise jamais un "PRALINE ... MAISON" ou tout autre produit visiblement fabriqué en interne (laisse univers_suggere et famille_suggere vides). Pour une ligne non "produit" (frais, sous-total, rupture, texte libre), laisse ces deux champs vides.

Catégories disponibles et leurs sous-catégories (inspirées des rayons de grande surface) :
- Boissons : Café & thé, Eaux, Jus & nectars, Sirops, Sodas, Énergisants
- Consommables : Jetables, Nettoyage, Papeterie caisse, Ustensiles pâtisserie
- Crèmerie : Beurre, Crèmes, Fromages, Lait, Œufs
- Fruits & Légumes frais : Fruits frais, Légumes frais
- Fruits secs & oléagineux : Fruits séchés, Oléagineux
- Meunerie : Farines, Graines, Mix & améliorants pain
- Surgelés : Fruits surgelés, Pâtisserie surgelée, Snacking surgelé, Viennoiserie surgelée
- Traiteur / Snacking salé : Charcuterie, Fromages snacking, Pizza, Poissons, Sauces & condiments traiteur
- Épicerie : Condiments & assaisonnements, Conserves, Huiles
- Épicerie sucrée : Additifs & texturants, Arômes & colorants, Chocolat & cacao, Décors & finitions, Sucres & édulcorants

Exemples : "COCA COLA UE 33CLx24" -> univers_suggere="Boissons", famille_suggere="Sodas". "BEURRE DOUX AOP CHARENTES" -> univers_suggere="Crèmerie", famille_suggere="Beurre". "FARINE PANIF PRESTIGE 25KG" -> univers_suggere="Meunerie", famille_suggere="Farines". "CROISSANT SECRETS 75gx144" -> univers_suggere="Surgelés", famille_suggere="Viennoiserie surgelée". "SAUMON FUME TRANCHE" -> univers_suggere="Traiteur / Snacking salé", famille_suggere="Poissons". "SALADE ICEBERG" -> univers_suggere="Fruits & Légumes frais", famille_suggere="Légumes frais". "AMANDE ENTIERE BRUTE DECORTIQUE" -> univers_suggere="Fruits secs & oléagineux", famille_suggere="Oléagineux". "CHOC NOIR EXCELLENCE 55%" -> univers_suggere="Épicerie sucrée", famille_suggere="Chocolat & cacao". "HUILE OLIVE EXTRA VIERGE" -> univers_suggere="Épicerie", famille_suggere="Huiles". "Gant nitril noir non poudré" -> univers_suggere="Consommables", famille_suggere="Jetables".

=== VÉRIFICATION FINALE (à faire une fois toutes les lignes analysées, avant de conclure) ===
Additionne les montants de toutes les lignes que tu as classées "produit" et "frais_ou_remise". Compare cette somme au montant total HT de la facture (identifié plus haut).
- Si les deux valeurs concordent (à quelques centimes près), dis-le explicitement : la facture est complète.
- Si elles ne concordent PAS, ne conclus pas immédiatement — c'est le signe qu'une ligne a été oubliée ou mal classée quelque part. Relis en particulier les zones où un "TOTAL :" de sous-catégorie apparaît au milieu du tableau (l'endroit le plus fréquent où une ligne se perd), et les ruptures ("Manquant") qui auraient pu masquer une vraie ligne produit à proximité. Corrige ce que tu trouves, puis refais la somme.
Termine ta réponse par un résumé explicite : nombre total de lignes "produit" identifiées, montant total recalculé, et écart final avec le total facturé (idéalement 0€).`

const FORMALISATION_PROMPT = `Tu vas recevoir le texte OCR brut d'une facture et une analyse déjà faite de cette facture, ligne par ligne, par un premier passage de raisonnement. Cette analyse a déjà tranché toutes les questions d'interprétation (classification de chaque ligne, assignation des valeurs, calcul du poids/volume par unité, vérification arithmétique, catégorisation).

TA SEULE TÂCHE ICI : transcrire fidèlement les conclusions de cette analyse dans le format JSON demandé. Tu ne raisonnes pas à nouveau, tu ne recalcules rien, tu ne remets rien en question — l'analyse a déjà fait ce travail. Pour chaque ligne que l'analyse a identifiée (produit, frais, sous-total, rupture ou texte libre), crée une entrée correspondante avec les valeurs déjà déterminées.

Si l'analyse a conclu que N lignes sont des "produit", ton JSON doit contenir exactement N entrées avec classification="produit" — ne complète jamais silencieusement une ligne oubliée par l'analyse, et n'en oublie aucune de celles qu'elle a listées. Si un champ n'a pas été déterminé par l'analyse (valeur non trouvée), utilise une chaîne vide "" plutôt que d'inventer.

Rappel sur "ligne_brute_complete" : c'est la transcription brute de la ligne telle que rapportée dans l'analyse (ou le texte OCR d'origine si l'analyse ne l'a pas recopiée intégralement), pas un résumé.
Rappel sur "poids_volume_par_unite" : reprends la valeur déjà calculée dans l'analyse, au format texte avec unité collée (ex: "2.5kg", "100piece").`

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

// Filet de sécurité déterministe : lignes de frais/remise/ajustement/sous-total à exclure même
// si le modèle les a quand même classifiées "produit" par erreur (défense en profondeur — la
// classification explicite du modèle reste la défense principale, voir corrigerLignes).
const MOTS_CLES_NON_PRODUIT = /FRAIS DE (TRANSPORT|PORT)|FRAIS IMPAYE|REJET PRELEVEMENT|RISTOURNE|REMISE|ESCOMPTE|ACOMPTE|ANNULATION|ARRHES|-+>?\s*TOTAL\s*:/i

// Classifications qui ne doivent jamais devenir une ligne de stock/coût — tout sauf "produit".
const CLASSIFICATIONS_A_EXCLURE = new Set([
  'frais_ou_remise', 'sous_total_categorie', 'rupture_non_livree', 'texte_libre_ignorer'
])

// ---------------------------------------------------------------------------
// Extrait un poids/volume explicite (kg/g/L/mL/cl) écrit dans la désignation, normalisé en
// {valeur, unite:'kg'|'L'}. Factorisé car réutilisé à la fois par detecterPoidsVolumeTexte (filet
// de secours n°2) et par le filet anti-inversion Cond'/Quantité (filet n°4) dans finaliserLigne.
// ---------------------------------------------------------------------------
function extrairePoidsExpliciteDesignation(designation) {
  if (!designation) return null
  const m = designation.match(/(\d+(?:[.,]\d+)?)\s*(KG|GRS|GRAMMES|GR|G|ML|CL|L)\b/i)
  if (!m) return null
  const valeur = parseFloat(m[1].replace(',', '.'))
  if (!(valeur > 0)) return null
  const unite = m[2].toUpperCase()
  if (unite === 'G' || unite === 'GR' || unite === 'GRS' || unite === 'GRAMMES') return { valeur: valeur / 1000, unite: 'kg' }
  if (unite === 'ML') return { valeur: valeur / 1000, unite: 'L' }
  if (unite === 'CL') return { valeur: valeur / 100, unite: 'L' }
  if (unite === 'KG') return { valeur, unite: 'kg' }
  if (unite === 'L') return { valeur, unite: 'L' }
  return null
}

// ---------------------------------------------------------------------------
// Calcul final déterministe d'une ligne à partir des champs bruts transcrits par le modèle.
// C'est ici, et non dans le modèle, que se fait toute l'arithmétique — donc testable.
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
  const explicite = extrairePoidsExpliciteDesignation(designation)
  if (explicite) return explicite
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
  // toujours à au moins 1 unité achetée). Cette vérification ne peut PAS détecter une inversion
  // entre quantite et conditionnement (multiplication commutative) — voir le filet n°4 plus bas
  // pour ce cas précis.
  let quantite = quantiteColonne
  if (prixUnitaire > 0 && montant > 0 && conditionnementColonne > 0) {
    const quantiteCalculeeExacte = montant / (prixUnitaire * conditionnementColonne)
    const ecart = Math.abs(quantiteCalculeeExacte - quantite) / (quantite || 1)
    if (ecart > 0.05) {
      // Le nombre de colis reçus est presque toujours un entier (une quantité mal lue par l'OCR,
      // ex: "8" lu "3", se détecte bien en arrondissant) — SAUF pour un produit vendu au poids
      // réel pesé (poissonnerie, fromage à la coupe...), où quantite_brute EST déjà la valeur
      // exacte et ne doit jamais être arrondie (cas réel constaté : "2,414" arrondi à tort en "2").
      // On ne fait donc confiance à l'arrondi que s'il retombe lui-même très près de la valeur
      // calculée exacte — sinon, la quantité brute décimale est la bonne, on la garde telle quelle.
      const quantiteArrondie = Math.round(quantiteCalculeeExacte)
      const ecartArrondi = Math.abs(quantiteArrondie - quantiteCalculeeExacte) / (quantiteCalculeeExacte || 1)
      if (quantiteArrondie >= 1 && ecartArrondi < 0.05) quantite = quantiteArrondie
    }
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

  // Filet de sécurité n°4 : détection d'inversion Cond'/Quantité. Sur certains formats de facture,
  // le texte de l'en-tête du tableau tel qu'extrait ne respecte pas l'ordre réel des colonnes, ce
  // qui peut faire lire par erreur le conditionnement à la place de la quantité (et vice-versa).
  // La vérification de cohérence ci-dessus (montant ≈ quantité × cond × prix) ne peut PAS détecter
  // ce cas précis : la multiplication étant commutative, le total reste cohérent quel que soit le
  // sens de l'inversion. On croise donc plutôt avec poidsVolume — déjà déterminé, lui, en priorité
  // depuis le texte de la désignation (filets 1/1bis/2 ci-dessus, indépendants de cette confusion
  // de colonnes) : si sa valeur correspond à la quantité lue plutôt qu'au conditionnement lu, c'est
  // le signe d'une inversion — on corrige la quantité réelle de colis reçus en conséquence.
  if (poidsVolume.unite !== 'piece' && conditionnementColonne > 0 && quantiteColonne > 0) {
    const ecartAvecCond = Math.abs(poidsVolume.valeur - conditionnementColonne) / poidsVolume.valeur
    const ecartAvecQte = Math.abs(poidsVolume.valeur - quantiteColonne) / poidsVolume.valeur
    if (ecartAvecQte < 0.02 && ecartAvecCond > 0.02) {
      quantite = conditionnementColonne
    }
  }

  // Filet de sécurité n°6 : sur les formats de facture qui impriment une métadonnée de
  // traçabilité "Qte=N" distincte des colonnes du tableau (constaté sur le fournisseur DGF), ce
  // nombre est un signal fiable et redondant, indépendant des colonnes ambiguës du tableau — donc
  // pas sujet aux mêmes erreurs (contamination par un sous-total voisin, inversion de colonnes).
  // Cas réel constaté : EXTRAIT VANILLE avait quantite_brute="5" et Qte=5 concordants dans la
  // donnée brute, mais un montant_brut contaminé par le sous-total voisin (437,04 au lieu de
  // 208,10) faisait dévier le filet de cohérence ci-dessus vers une quantité corrigée à tort (11).
  // On fait donc confiance à "Qte=" en dernier recours quand elle diverge de la quantité retenue.
  const matchQte = ligneBrute.ligne_brute_complete
    ? ligneBrute.ligne_brute_complete.match(/\bQte\s*=\s*(\d+(?:[.,]\d+)?)/i)
    : null
  if (matchQte) {
    const quantiteFiable = parseNombre(matchQte[1])
    if (quantiteFiable > 0 && Math.abs(quantiteFiable - quantite) / quantite > 0.02) {
      quantite = quantiteFiable
    }
  }

  return {
    designation,
    reference: ligneBrute.reference || '',
    quantite,
    conditionnement: poidsVolume.valeur,
    unite: poidsVolume.unite,
    prix_unitaire_ht: prixUnitaire,
    montant_ht: montant,
    univers_suggere: ligneBrute.univers_suggere || '',
    famille_suggere: ligneBrute.famille_suggere || ''
  }
}

// ---------------------------------------------------------------------------
// Filet de sécurité n°5, déterministe (JS, pas le modèle) : récupération d'une ligne produit
// fusionnée avec un sous-total de catégorie. Constaté en usage réel : malgré une instruction
// explicite et un exemple travaillé dans le prompt (voir ANALYSE_LIBRE_PROMPT), le modèle continue
// par moments à faire atterrir les valeurs numériques d'une ligne produit (Cond'/Quantité/Prix/
// Montant) APRÈS le texte "TOTAL : ..." dans ligne_brute_complete, au lieu de les laisser sur
// leur propre entrée "produit" — cf. le cas réel "TARTINABLE PHILADELPHIA NATURE 1.650KG Qte=4
// DLC=05/08/2026 Lot Frs=OFA1360653 ---> TOTAL : PRODUITS FRAIS 1,65 4 10,932 72,15 1 5", où
// "1,65 4 10,932 72,15" sont bien les valeurs de TARTINABLE, pas du sous-total. On ne continue
// pas à négocier avec le prompt sur ce point précis : on récupère la donnée nous-mêmes.
// ---------------------------------------------------------------------------
function recupererLigneAvantTotal(ligneBrute) {
  const texte = ligneBrute.ligne_brute_complete || ''
  const matchTotal = texte.match(/-+>?\s*TOTAL\s*:\s*[^\d]*/i)
  if (!matchTotal) return null

  // La désignation s'arrête à la première des deux bornes : le début des métadonnées de
  // traçabilité ("Qte=...") ou le marqueur de sous-total lui-même, selon ce qui vient en premier.
  const indexQte = texte.search(/Qte\s*=/i)
  const borne = Math.min(indexQte >= 0 ? indexQte : Infinity, matchTotal.index)
  const designation = texte.slice(0, borne).trim()
  if (designation.length < 3) return null

  // Nombres trouvés APRÈS le marqueur de sous-total : ce sont les valeurs Cond'/Quantité/Prix/
  // Montant de la ligne produit fusionnée. On exige au moins 3 valeurs pour reconstruire de façon
  // fiable (conditionnement, quantité, prix — le montant peut être recalculé) ; en dessous, mieux
  // vaut ne rien reconstruire que de deviner, la ligne reste alors "à vérifier" manuellement.
  const apresTotal = texte.slice(matchTotal.index + matchTotal[0].length)
  const nombres = apresTotal.match(/\d+(?:[.,]\d+)?/g) || []
  if (nombres.length < 3) {
    console.warn('OCR — ligne fusionnée avec un sous-total, pas assez de valeurs pour la récupérer automatiquement :', texte)
    return null
  }

  const [cond, qte, prix, montant] = nombres
  console.warn('OCR — ligne produit récupérée depuis un sous-total fusionné par le modèle :', designation, '| brut :', texte)
  return {
    ligne_brute_complete: texte,
    classification: 'produit',
    analyse: 'Reconstruit par filet de sécurité JS (ligne fusionnée avec un sous-total par le modèle).',
    designation,
    conditionnement_colonne_brute: cond || '',
    quantite_brute: qte || '',
    prix_unitaire_brut: prix || '',
    montant_brut: montant || '',
    poids_volume_par_unite: '',
    univers_suggere: '',
    famille_suggere: ''
  }
}

function corrigerLignes(lignesBrutes) {
  if (!Array.isArray(lignesBrutes)) return []
  const result = []
  for (const ligneBrute of lignesBrutes) {
    if (!ligneBrute.designation) continue

    // Défense n°1 (principale) : classification explicite décidée par le modèle avant même de
    // remplir les champs numériques — voir ANALYSE_LIBRE_PROMPT, étape 2.
    if (CLASSIFICATIONS_A_EXCLURE.has(ligneBrute.classification)) {
      // Avant d'exclure un sous-total de catégorie, on tente de récupérer une ligne produit que
      // le modèle y aurait fusionnée par erreur (filet n°5, voir plus haut).
      if (ligneBrute.classification === 'sous_total_categorie') {
        const recuperee = recupererLigneAvantTotal(ligneBrute)
        if (recuperee) {
          const ligne = finaliserLigne(recuperee)
          if (!(ligne.prix_unitaire_ht === 0 && ligne.montant_ht === 0)) result.push(ligne)
        }
      }
      continue
    }

    // Défense n°2 (secours) : filet par mots-clés sur la désignation, indépendant du modèle, au
    // cas où la classification aurait été mal renseignée.
    if (MOTS_CLES_NON_PRODUIT.test(ligneBrute.designation)) continue

    // Défense n°3 (secours) : le mot "Manquant" peut apparaître dans les colonnes prix/montant
    // plutôt que dans la désignation — cas réel constaté (rupture de stock fournisseur).
    const texteValeurs = `${ligneBrute.prix_unitaire_brut || ''} ${ligneBrute.montant_brut || ''}`
    if (/manquant/i.test(texteValeurs)) continue

    const ligne = finaliserLigne(ligneBrute)

    // Défense n°4 (secours) : une ligne sans aucune valeur financière (prix ET montant nuls après
    // parsing) ne correspond à rien de réellement facturé — échantillon gratuit, ligne
    // informative résiduelle, etc. Cas réel constaté sur des factures de farine.
    if (ligne.prix_unitaire_ht === 0 && ligne.montant_ht === 0) continue

    result.push(ligne)
  }
  return result
}

/**
 * Extrait les données structurées d'une facture PDF (base64, sans le préfixe data:...).
 * Retourne { extracted, needsReview, confidence, rawText }.
 *
 * Fonctionne en 3 étapes séparées plutôt qu'un seul appel structuré :
 *   1. OCR brut (texte/markdown) — Mistral fait ça très bien nativement, aucun raisonnement requis.
 *   2. Analyse libre, en texte, SANS contrainte de format JSON — le modèle peut relire, comparer,
 *      revenir en arrière, se vérifier lui-même avant de conclure sur quoi que ce soit. C'est cette
 *      étape qui reproduit la façon dont un humain relit une facture avant de la ranger.
 *   3. Formalisation en JSON structuré à partir de cette analyse déjà faite — le modèle n'a plus
 *      qu'à recopier des conclusions déjà posées dans le format attendu, sans avoir à raisonner et
 *      structurer en même temps (ce qui, en une seule passe sur ~90 lignes, est le point où des
 *      lignes se perdaient malgré des instructions explicites).
 * Coût et latence plus élevés qu'un seul appel (3 requêtes au lieu d'1), assumé délibérément : la
 * fiabilité de l'extraction compte plus que la vitesse ou le coût par facture pour ce produit.
 */
export async function extractInvoiceData(base64Pdf) {
  // ÉTAPE 1 — OCR brut, sans annotation : on ne demande que le texte/markdown.
  const ocrResponse = await fetch('https://api.mistral.ai/v1/ocr', {
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
      include_image_base64: false
    })
  })

  if (!ocrResponse.ok) {
    const errText = await ocrResponse.text().catch(() => '')
    throw new Error(`Erreur API OCR Mistral, étape 1/3 (${ocrResponse.status}): ${errText}`)
  }

  const ocrData = await ocrResponse.json()
  const rawText = (ocrData.pages || []).map(p => p.markdown || '').join('\n\n')

  if (!rawText.trim()) {
    throw new Error('Erreur OCR : aucun texte extrait du document (page(s) vide(s) ou illisible(s)).')
  }

  // ÉTAPE 2 — analyse libre, en texte, à partir du texte OCR brut.
  const analyseResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'mistral-large-latest',
      temperature: 0,
      messages: [
        { role: 'system', content: ANALYSE_LIBRE_PROMPT },
        { role: 'user', content: rawText }
      ]
    })
  })

  if (!analyseResponse.ok) {
    const errText = await analyseResponse.text().catch(() => '')
    throw new Error(`Erreur API OCR Mistral, étape 2/3 — analyse (${analyseResponse.status}): ${errText}`)
  }

  const analyseData = await analyseResponse.json()
  const analyseTexte = analyseData.choices?.[0]?.message?.content || ''

  console.log('OCR — analyse libre (étape 2/3, pour diagnostic) :', analyseTexte)

  if (!analyseTexte.trim()) {
    throw new Error('Erreur OCR : analyse vide renvoyée par le modèle à l\'étape 2/3.')
  }

  // ÉTAPE 3 — formalisation en JSON structuré à partir de l'analyse déjà faite.
  const jsonResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'mistral-large-latest',
      temperature: 0,
      response_format: INVOICE_SCHEMA,
      messages: [
        { role: 'system', content: FORMALISATION_PROMPT },
        { role: 'user', content: `=== TEXTE OCR BRUT DE LA FACTURE ===\n${rawText}\n\n=== ANALYSE DÉJÀ FAITE (à formaliser en JSON, sans rien recalculer) ===\n${analyseTexte}` }
      ]
    })
  })

  if (!jsonResponse.ok) {
    const errText = await jsonResponse.text().catch(() => '')
    throw new Error(`Erreur API OCR Mistral, étape 3/3 — formalisation (${jsonResponse.status}): ${errText}`)
  }

  const jsonData = await jsonResponse.json()

  let brut = null
  let parseFailed = false
  try {
    brut = JSON.parse(jsonData.choices?.[0]?.message?.content || '')
  } catch (e) {
    parseFailed = true
    brut = { fournisseur: {}, facture: {}, lignes: [] }
  }

  console.log('OCR — données brutes formalisées en JSON (étape 3/3, pour diagnostic) :', JSON.parse(JSON.stringify(brut)))

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

  // Contrôle de cohérence indépendant du modèle : la facture indique elle-même son propre total
  // HT. Si la somme des lignes retenues (+ les frais/remises légitimement exclus du stock, dont
  // on connaît quand même le montant) s'en écarte significativement, c'est un signal fiable qu'une
  // ou plusieurs lignes ont été perdues (quelle qu'en soit la cause) — même si aucune erreur
  // ponctuelle n'a été détectée par ailleurs. On réintègre les frais/remises dans le total attendu
  // pour ne pas déclencher une fausse alerte sur les factures avec frais de transport légitimes
  // (exclus du stock mais bien comptés dans le total HT de la facture).
  const totalLignes = extracted.lignes.reduce((somme, l) => somme + l.montant_ht, 0)
  const totalFrais = (brut.lignes || [])
    .filter(l => l.classification === 'frais_ou_remise')
    .reduce((somme, l) => somme + parseNombre(l.montant_brut), 0)
  const totalAttendu = totalLignes + totalFrais
  const totalFacture = extracted.facture.montant_total_ht
  const ecartMontant = totalFacture > 0 ? Math.abs(totalFacture - totalAttendu) : 0
  const ecartSuspect = totalFacture > 0 && ecartMontant > 2
  extracted.controleTotal = { totalLignes: Math.round(totalLignes * 100) / 100, totalFrais: Math.round(totalFrais * 100) / 100, totalFacture, ecart: Math.round(ecartMontant * 100) / 100, suspect: ecartSuspect }
  if (ecartSuspect) {
    console.warn(`OCR — écart suspect entre le total facturé (${totalFacture}€) et la somme des lignes + frais extraits (${totalAttendu.toFixed(2)}€) : ${ecartMontant.toFixed(2)}€ manquant. Des lignes ont probablement été perdues — vérifier manuellement.`)
  }

  const champsClesManquants =
    !extracted.fournisseur?.nom &&
    !extracted.facture?.montant_total_ttc &&
    (!extracted.lignes || extracted.lignes.length === 0)

  // Le score de confiance page par page n'existe que sur l'endpoint d'annotation OCR intégré ;
  // en 3 étapes séparées on ne l'a plus — on s'appuie sur les autres signaux (échec de parsing,
  // champs clés manquants, écart de montant) qui sont de toute façon plus fiables.
  const confidence = null

  const needsReview = parseFailed || champsClesManquants || ecartSuspect

  return { extracted, needsReview, confidence, rawText }
}

export { fileToBase64 }
