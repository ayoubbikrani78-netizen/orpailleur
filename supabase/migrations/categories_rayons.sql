-- ============================================================
-- Migration : nouvelle segmentation Mercuriale — logique rayons de
-- grande surface (Épicerie sucrée, Crèmerie, Surgelés...) plutôt que
-- l'ancienne segmentation métier (Boisson, Pâtisserie, Snacking...).
-- Remplace entièrement le référentiel categories_mercuriale.
-- ============================================================

-- On repart propre : l'ancienne segmentation ne doit plus apparaître
-- dans les menus déroulants.
delete from categories_mercuriale;

-- Si des articles avaient déjà été catégorisés avec l'ancien référentiel,
-- on les repasse à vide plutôt que de garder une valeur incohérente.
update matieres_premieres set univers = null, famille = null
where univers is not null or famille is not null;

insert into categories_mercuriale (univers, famille) values
  ('Boissons', 'Café & thé'),
  ('Boissons', 'Eaux'),
  ('Boissons', 'Jus & nectars'),
  ('Boissons', 'Sirops'),
  ('Boissons', 'Sodas'),
  ('Boissons', 'Énergisants'),
  ('Consommables', 'Jetables'),
  ('Consommables', 'Nettoyage'),
  ('Consommables', 'Papeterie caisse'),
  ('Consommables', 'Ustensiles pâtisserie'),
  ('Crèmerie', 'Beurre'),
  ('Crèmerie', 'Crèmes'),
  ('Crèmerie', 'Fromages'),
  ('Crèmerie', 'Lait'),
  ('Crèmerie', 'Œufs'),
  ('Fruits & Légumes frais', 'Fruits frais'),
  ('Fruits & Légumes frais', 'Légumes frais'),
  ('Fruits secs & oléagineux', 'Fruits séchés'),
  ('Fruits secs & oléagineux', 'Oléagineux'),
  ('Meunerie', 'Farines'),
  ('Meunerie', 'Graines'),
  ('Meunerie', 'Mix & améliorants pain'),
  ('Surgelés', 'Fruits surgelés'),
  ('Surgelés', 'Pâtisserie surgelée'),
  ('Surgelés', 'Snacking surgelé'),
  ('Surgelés', 'Viennoiserie surgelée'),
  ('Traiteur / Snacking salé', 'Charcuterie'),
  ('Traiteur / Snacking salé', 'Fromages snacking'),
  ('Traiteur / Snacking salé', 'Pizza'),
  ('Traiteur / Snacking salé', 'Poissons'),
  ('Traiteur / Snacking salé', 'Sauces & condiments traiteur'),
  ('Épicerie', 'Condiments & assaisonnements'),
  ('Épicerie', 'Conserves'),
  ('Épicerie', 'Huiles'),
  ('Épicerie sucrée', 'Additifs & texturants'),
  ('Épicerie sucrée', 'Arômes & colorants'),
  ('Épicerie sucrée', 'Chocolat & cacao'),
  ('Épicerie sucrée', 'Décors & finitions'),
  ('Épicerie sucrée', 'Sucres & édulcorants');
