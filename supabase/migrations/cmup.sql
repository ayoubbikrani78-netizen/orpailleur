-- ============================================================
-- Migration : CMUP réel (jusqu'ici, matieres_premieres.cmp n'était
-- jamais calculé — cette migration corrige ça à la source).
-- ============================================================

alter table mouvements_stock add column if not exists prix_g_u_ml numeric;
