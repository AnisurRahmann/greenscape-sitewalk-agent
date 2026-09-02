-- 0009_line_item_catalog_snapshot — denormalize the catalog identity onto
-- proposal_line_items so a proposal is a reproducible artifact rather than a
-- live join: renaming or re-pricing a catalog item later cannot rewrite what
-- a stored proposal says. sku and catalog_name are nullable — unmatched
-- lines carry neither (their description falls back to the normalized query,
-- never the raw transcript phrase, which lives in transcript_evidence only).

alter table proposal_line_items
  add column if not exists sku text,
  add column if not exists catalog_name text;

-- Backfill rows written before the snapshot existed (demo seed included)
-- from the catalog so identity columns are not left blank.
update proposal_line_items pli
set sku = c.sku,
    catalog_name = c.name
from catalog_items c
where pli.catalog_item_id = c.id;
