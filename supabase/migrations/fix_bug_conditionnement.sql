-- ============================================================
-- Migration : correctif du bug de calcul de prix (division en trop
-- par le conditionnement). Ajoute un drapeau pour que le rattrapage
-- rétroactif ne puisse être appliqué qu'une seule fois.
-- ============================================================

alter table reglages add column if not exists prix_historique_corrige_le timestamptz;
