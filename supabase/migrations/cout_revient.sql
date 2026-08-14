-- ============================================================
-- Migration : brique "Coût de revient"
-- À exécuter dans l'éditeur SQL Supabase, ou via la CLI.
-- ============================================================

-- Paramètres globaux : réutilise la table reglages mono-ligne existante
alter table reglages add column if not exists tva_defaut numeric default 0.055;
alter table reglages add column if not exists tva_sur_place numeric default 0.10;
alter table reglages add column if not exists perte_defaut numeric default 0.08;
alter table reglages add column if not exists seuil_marge numeric default 0.60;
alter table reglages add column if not exists heures_mensuelles numeric default 151.67;

-- Ateliers et taux horaires chargés (€/h)
create table if not exists ateliers (
  id uuid primary key default gen_random_uuid(),
  nom text unique not null,
  taux_horaire numeric not null default 0
);

-- Barème énergie de cuisson : coût forfaitaire par palier de durée (€/fournée)
create table if not exists bareme_energie (
  id uuid primary key default gen_random_uuid(),
  tps_cuisson_min numeric not null,
  cout numeric not null
);

-- Recettes : un produit vendu, OU un composant/semi-fini maison (est_composant = true)
create table if not exists recettes (
  id uuid primary key default gen_random_uuid(),
  famille text not null,
  nom text not null,
  atelier_id uuid references ateliers(id),
  qte_produit numeric not null default 1,       -- pièces obtenues par la recette telle qu'écrite
  volume_prod numeric not null default 1,        -- pièces réellement produites en une fournée
  tps_prepa_min numeric,
  tps_cuisson_min numeric default 0,
  packaging_u numeric default 0,
  perte_pct numeric,                             -- NULL = utilise reglages.perte_defaut
  tva_pct numeric,                                -- NULL = utilise reglages.tva_defaut
  pv_ttc numeric,
  est_composant boolean not null default false,
  matiere_premiere_id uuid references matieres_premieres(id), -- si composant : la MP qu'il alimente
  created_at timestamptz default now()
);
create index if not exists idx_recettes_famille on recettes(famille);

-- Éléments (sous-recettes) d'une recette : "Biscuit", "Ganache"...
create table if not exists recette_elements (
  id uuid primary key default gen_random_uuid(),
  recette_id uuid references recettes(id) on delete cascade,
  nom text not null,
  ordre integer default 0
);

-- Lignes d'ingrédients par élément
create table if not exists recette_ingredients (
  id uuid primary key default gen_random_uuid(),
  element_id uuid references recette_elements(id) on delete cascade,
  matiere_premiere_id uuid references matieres_premieres(id),
  quantite numeric not null,
  unite text not null,
  ordre integer default 0
);

-- RLS cohérente avec le reste du projet (mono-utilisateur : le boulanger + son associé)
alter table ateliers enable row level security;
alter table bareme_energie enable row level security;
alter table recettes enable row level security;
alter table recette_elements enable row level security;
alter table recette_ingredients enable row level security;

create policy "Autoriser tout sur ateliers" on ateliers for all using (true) with check (true);
create policy "Autoriser tout sur bareme_energie" on bareme_energie for all using (true) with check (true);
create policy "Autoriser tout sur recettes" on recettes for all using (true) with check (true);
create policy "Autoriser tout sur recette_elements" on recette_elements for all using (true) with check (true);
create policy "Autoriser tout sur recette_ingredients" on recette_ingredients for all using (true) with check (true);

-- Données de départ, reprises telles quelles du fichier Excel de ton associé
insert into ateliers (nom, taux_horaire) values
  ('Pâtisserie', 36.90),
  ('Boulangerie', 27.03),
  ('Snack', 16.86),
  ('Pizza', 16.86),
  ('Service', 16.86)
on conflict (nom) do nothing;

insert into bareme_energie (tps_cuisson_min, cout) values
  (0, 0), (12, 0.112), (15, 0.136), (20, 0.176),
  (30, 0.256), (45, 0.376), (60, 0.496), (240, 1.936);
