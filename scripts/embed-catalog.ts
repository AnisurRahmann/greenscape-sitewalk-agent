/**
 * Embeds every catalog item that has no vector yet, using OpenAI
 * text-embedding-3-small (1536 dims, matching the vector(1536) column).
 * Text embedded is "name + description + category". Batched API calls;
 * per-row writes back to Supabase. Logs total tokens and embedding cost.
 *
 * Requires .env.local with:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY
 */
import OpenAI from 'openai';

import { embeddingText } from './catalog-data';
import { scriptSupabase } from './lib/supabase';

// text-embedding-3-small: $0.02 per 1M tokens (Aug 2026 list price).
const MODEL = 'text-embedding-3-small';
const COST_PER_1M_TOKENS_USD = 0.02;
const BATCH_SIZE = 64;

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY missing — set it in .env.local');
    process.exitCode = 1;
    return;
  }
  const openai = new OpenAI({ apiKey });
  const supabase = scriptSupabase();

  const { data: items, error } = await supabase
    .from('catalog_items')
    .select('id, name, description, category')
    .is('embedding', null)
    .order('sku');

  if (error) {
    console.error('failed to load catalog:', error.message);
    process.exitCode = 1;
    return;
  }
  if (!items || items.length === 0) {
    console.log('nothing to embed — every catalog item already has a vector');
    return;
  }

  console.log(`embedding ${items.length} items with ${MODEL}, batches of ${BATCH_SIZE}`);
  let totalTokens = 0;

  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    const input = batch.map(embeddingText);

    const response = await openai.embeddings.create({ model: MODEL, input });
    totalTokens += response.usage.total_tokens;

    for (const [offset, item] of batch.entries()) {
      const vector = response.data[offset]?.embedding;
      if (!vector) throw new Error(`no embedding returned for ${item.id}`);
      // pgvector accepts the bracketed string form '[d1,d2,...]'
      const { error: updateError } = await supabase
        .from('catalog_items')
        .update({ embedding: JSON.stringify(vector) })
        .eq('id', item.id);
      if (updateError) throw new Error(`update failed for ${item.id}: ${updateError.message}`);
    }

    console.log(`  ${Math.min(start + BATCH_SIZE, items.length)}/${items.length}`);
  }

  const costUsd = (totalTokens / 1_000_000) * COST_PER_1M_TOKENS_USD;
  console.log(`total tokens: ${totalTokens}`);
  console.log(`estimated embedding cost: $${costUsd.toFixed(4)}`);
}

void main();
