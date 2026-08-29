-- ============================================================
-- Migration : traçabilité facture sur les liens fournisseurs.
-- Permet d'afficher, sur chaque fiche Mercuriale, de quelle facture
-- vient le prix actuel de chaque fournisseur.
-- ============================================================

alter table matieres_premieres_fournisseurs add column if not exists derniere_facture_id uuid references factures(id);
