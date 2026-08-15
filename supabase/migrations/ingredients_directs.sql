-- ============================================================
-- Migration : ingrédients directs (sans élément/sous-recette)
-- Une ligne d'ingrédient peut désormais être rattachée SOIT à un
-- élément (sous-recette), SOIT directement à la recette — jamais les deux.
-- ============================================================

alter table recette_ingredients add column if not exists recette_id uuid references recettes(id) on delete cascade;

alter table recette_ingredients drop constraint if exists recette_ingredients_un_seul_parent;
alter table recette_ingredients add constraint recette_ingredients_un_seul_parent check (
  (element_id is not null and recette_id is null) or (element_id is null and recette_id is not null)
);

create index if not exists idx_recette_ingredients_recette_id on recette_ingredients(recette_id);
