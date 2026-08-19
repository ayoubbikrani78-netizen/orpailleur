-- ============================================================
-- Migration : référence interne par matière première (ex: CR001),
-- pour regrouper visuellement un même article vendu par plusieurs
-- fournisseurs sous des désignations différentes.
-- ============================================================

alter table matieres_premieres add column if not exists code text;
create unique index if not exists matieres_premieres_code_unique on matieres_premieres(code) where code is not null;
