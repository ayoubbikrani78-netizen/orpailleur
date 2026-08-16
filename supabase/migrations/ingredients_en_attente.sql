-- ============================================================
-- Migration : ingrédients "en attente" de rapprochement.
-- Une ligne de recette peut être créée avec seulement un nom brut
-- (ex: importée depuis un fichier universel, sans lien avec un vrai
-- article Mercuriale pour l'instant). matiere_premiere_id est rempli
-- automatiquement plus tard, dès qu'un article correspondant apparaît.
-- ============================================================

alter table recette_ingredients add column if not exists designation_brute text;

alter table recette_ingredients drop constraint if exists recette_ingredients_matiere_ou_brute;
alter table recette_ingredients add constraint recette_ingredients_matiere_ou_brute check (
  matiere_premiere_id is not null or designation_brute is not null
);
