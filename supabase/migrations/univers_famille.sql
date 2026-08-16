-- ============================================================
-- Migration : catégorisation Univers / Famille sur la Mercuriale
-- (reprise à l'identique du fichier Excel de référence — 33 couples).
-- ============================================================

alter table matieres_premieres add column if not exists univers text;
alter table matieres_premieres add column if not exists famille text;

-- Référentiel des couples Univers/Famille déjà utilisés, pour peupler
-- les menus déroulants et garder une orthographe cohérente dans toute l'app.
create table if not exists categories_mercuriale (
  univers text not null,
  famille text not null,
  primary key (univers, famille)
);
alter table categories_mercuriale enable row level security;
create policy "Autoriser tout sur categories_mercuriale" on categories_mercuriale for all using (true) with check (true);

insert into categories_mercuriale (univers, famille) values
  ('BOISSON', 'CAFE'),
  ('BOISSON', 'EAU'),
  ('BOISSON', 'EAU AROMATISE'),
  ('BOISSON', 'EAU GAZEUSE'),
  ('BOISSON', 'JUS'),
  ('BOISSON', 'JUS PRESSE'),
  ('BOISSON', 'SIROP'),
  ('BOISSON', 'SODA'),
  ('BOISSON', 'THE'),
  ('BOISSON', 'THE FRAIS'),
  ('BOULANGERIE', 'EAU ROBINET'),
  ('BOULANGERIE', 'HYGIÈNE & ENTRETIEN'),
  ('BOULANGERIE', 'ÉPICERIE'),
  ('FOURNITURE ALIMENTAIRE', 'ÉPICERIE'),
  ('PAIN', 'MEUNERIE'),
  ('PÂTISSERIE', 'CRÈMERIE'),
  ('PÂTISSERIE', 'FRUITS FRAIS'),
  ('PÂTISSERIE', 'LÉGUMES FRAIS'),
  ('PÂTISSERIE', 'MEUNERIE'),
  ('PÂTISSERIE', 'RECYCLING'),
  ('PÂTISSERIE', 'SURGELE'),
  ('PÂTISSERIE', 'ÉPICERIE'),
  ('SNACKING', 'CHARCUTERIE'),
  ('SNACKING', 'CRÈMERIE'),
  ('SNACKING', 'EPICERIE'),
  ('SNACKING', 'FRAIS'),
  ('SNACKING', 'LÉGUMES FRAIS'),
  ('SNACKING', 'SURGELE'),
  ('SNACKING', 'ÉPICERIE'),
  ('VIENNOISERIE', 'CRÈMERIE'),
  ('VIENNOISERIE', 'MEUNERIE'),
  ('VIENNOISERIE', 'SURGELE'),
  ('VIENNOISERIE', 'ÉPICERIE')
on conflict do nothing;
