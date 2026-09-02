-- 0012_line_item_cost_source — where a line's unit_cost came from:
--   'catalog'  copied from the matched catalog item by the pipeline
--   'reviewer' typed by a human when manually pricing an unmatched line
--   'derived'  auto-filled at the default 55%-of-price ratio (visible in the
--              review UI so the derivation is not silent)
-- Null for unmatched lines, which carry no cost at all.

alter table proposal_line_items
  add column if not exists cost_source text
  check (cost_source in ('catalog', 'reviewer', 'derived'));

-- Backfill: pre-existing priced rows took their cost from the catalog.
update proposal_line_items
set cost_source = 'catalog'
where catalog_item_id is not null
  and unit_cost > 0;
