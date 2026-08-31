-- 0002_search_fns.sql — catalog retrieval.
--
-- Three strategies, each returning the top-N candidates with a score:
--   vector  : cosine distance on the query embedding (HNSW index)
--   lexical : websearch_to_tsquery against search_tsv, ranked by ts_rank_cd
--   fuzzy   : pg_trgm word_similarity on name, catching misheard
--             transcriptions ("travertyne", "pergula")
--
-- match_catalog_fused fuses them with reciprocal rank fusion (k=60) close to
-- the data. Callers (src/lib/retrieval/matchCatalog.ts) reach these via rpc;
-- the score column is strategy-specific, ranks are assigned here so the
-- client never re-ranks.

-- ---------------------------------------------------------------------------
-- Individual strategies (also used directly by the eval harness)
-- ---------------------------------------------------------------------------

create or replace function search_catalog_vector(
  p_query_embedding vector(1536),
  p_match_count int default 10
)
returns table (
  id uuid,
  sku text,
  category text,
  name text,
  description text,
  unit text,
  unit_price numeric,
  unit_cost numeric,
  min_qty numeric,
  notes text,
  score double precision
)
language sql
stable
as $$
  select ci.id, ci.sku, ci.category, ci.name, ci.description,
         ci.unit, ci.unit_price, ci.unit_cost, ci.min_qty, ci.notes,
         1 - (ci.embedding <=> p_query_embedding) as score
  from catalog_items ci
  where ci.embedding is not null
  order by ci.embedding <=> p_query_embedding
  limit p_match_count;
$$;

create or replace function search_catalog_lexical(
  p_raw_query text,
  p_match_count int default 10
)
returns table (
  id uuid,
  sku text,
  category text,
  name text,
  description text,
  unit text,
  unit_price numeric,
  unit_cost numeric,
  min_qty numeric,
  notes text,
  score double precision
)
language sql
stable
as $$
  select ci.id, ci.sku, ci.category, ci.name, ci.description,
         ci.unit, ci.unit_price, ci.unit_cost, ci.min_qty, ci.notes,
         ts_rank_cd(ci.search_tsv, websearch_to_tsquery('english', p_raw_query))::double precision as score
  from catalog_items ci
  where ci.search_tsv @@ websearch_to_tsquery('english', p_raw_query)
  order by ts_rank_cd(ci.search_tsv, websearch_to_tsquery('english', p_raw_query)) desc
  limit p_match_count;
$$;

create or replace function search_catalog_fuzzy(
  p_raw_query text,
  p_match_count int default 10
)
returns table (
  id uuid,
  sku text,
  category text,
  name text,
  description text,
  unit text,
  unit_price numeric,
  unit_cost numeric,
  min_qty numeric,
  notes text,
  score double precision
)
language sql
stable
-- Pin the threshold: Supabase images ship pg_trgm.word_similarity_threshold
-- = 0.6, which drops legit mishearings like "pergula" -> "Pergola" (0.5).
set pg_trgm.word_similarity_threshold = '0.3'
as $$
  select ci.id, ci.sku, ci.category, ci.name, ci.description,
         ci.unit, ci.unit_price, ci.unit_cost, ci.min_qty, ci.notes,
         word_similarity(p_raw_query, ci.name)::double precision as score
  from catalog_items ci
  where p_raw_query <% ci.name
  order by word_similarity(p_raw_query, ci.name) desc
  limit p_match_count;
$$;

-- ---------------------------------------------------------------------------
-- Fusion: reciprocal rank fusion over the three strategy rankings.
--
-- fused_score = sum(1 / (rrf_k + rank)) across the strategies that surfaced
-- the item. The theoretical max (rank 1 in all three) is 3 / (rrf_k + 1);
-- matchCatalog.ts normalises confidence against that.
--
-- match_method: 'hybrid' when two or more strategies rank the item in their
-- top 3; otherwise the strategy with the best rank for the item (ties break
-- vector > lexical > fuzzy).
-- ---------------------------------------------------------------------------

create or replace function match_catalog_fused(
  p_query_embedding vector(1536),
  p_raw_query text,
  p_match_count int default 5,
  p_rrf_k int default 60,
  p_strategy_depth int default 10
)
returns table (
  id uuid,
  sku text,
  category text,
  name text,
  description text,
  unit text,
  unit_price numeric,
  unit_cost numeric,
  min_qty numeric,
  notes text,
  fused_score double precision,
  vector_rank int,
  lexical_rank int,
  fuzzy_rank int,
  match_method text
)
language sql
stable
as $$
  with vec as (
    select v.id, row_number() over (order by v.score desc)::int as rnk
    from search_catalog_vector(p_query_embedding, p_strategy_depth) v
  ),
  lex as (
    select l.id, row_number() over (order by l.score desc)::int as rnk
    from search_catalog_lexical(p_raw_query, p_strategy_depth) l
  ),
  fz as (
    select f.id, row_number() over (order by f.score desc)::int as rnk
    from search_catalog_fuzzy(p_raw_query, p_strategy_depth) f
  ),
  hits as (
    select id, rnk, 'vector'::text as src from vec
    union all
    select id, rnk, 'lexical'::text from lex
    union all
    select id, rnk, 'fuzzy'::text from fz
  ),
  fused as (
    select id,
           sum(1.0 / (p_rrf_k + rnk)) as fused_score,
           min(rnk) filter (where src = 'vector') as vector_rank,
           min(rnk) filter (where src = 'lexical') as lexical_rank,
           min(rnk) filter (where src = 'fuzzy') as fuzzy_rank
    from hits
    group by id
  )
  select ci.id, ci.sku, ci.category, ci.name, ci.description,
         ci.unit, ci.unit_price, ci.unit_cost, ci.min_qty, ci.notes,
         fu.fused_score, fu.vector_rank, fu.lexical_rank, fu.fuzzy_rank,
         case
           when (case when fu.vector_rank <= 3 then 1 else 0 end)
              + (case when fu.lexical_rank <= 3 then 1 else 0 end)
              + (case when fu.fuzzy_rank <= 3 then 1 else 0 end) >= 2
             then 'hybrid'
           when fu.vector_rank is not null
                and (fu.lexical_rank is null or fu.vector_rank <= fu.lexical_rank)
                and (fu.fuzzy_rank is null or fu.vector_rank <= fu.fuzzy_rank)
             then 'vector'
           when fu.lexical_rank is not null
                and (fu.fuzzy_rank is null or fu.lexical_rank <= fu.fuzzy_rank)
             then 'lexical'
           else 'fuzzy'
         end as match_method
  from fused fu
  join catalog_items ci on ci.id = fu.id
  order by fu.fused_score desc
  limit least(p_match_count, p_strategy_depth);
$$;
