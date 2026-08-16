-- ============================================================
-- Migration : seuils d'alerte manquants (repris intégralement
-- de l'onglet Paramètres du fichier Excel de référence).
-- ============================================================

alter table reglages add column if not exists seuil_alerte_prix numeric default 0.10;
alter table reglages add column if not exists seuil_ecart_pvmo_pvmd numeric default 0.10;

insert into ateliers (nom, taux_horaire) values
  ('Pâtisserie (déclaré)', 23.70)
on conflict (nom) do nothing;
