-- 0004_catalog_materials_ratio.sql — share of each line's price that is
-- materials, for Phoenix sales tax (tax applies to materials only).
-- Default 0.45; bulk-material and labor-heavy SKUs override via the seed.

alter table catalog_items
  add column if not exists materials_ratio numeric not null default 0.45;
