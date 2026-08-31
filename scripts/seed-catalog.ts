/**
 * Seeds the pricing catalog into catalog_items. Idempotent: upserts on sku,
 * so re-running updates prices without touching existing embeddings.
 *
 * Requires .env.local with:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 */
import { scriptSupabase } from './lib/supabase';
import { CATALOG_ROWS } from './catalog-data';

async function main(): Promise<void> {
  const supabase = scriptSupabase();

  const { count, error } = await supabase
    .from('catalog_items')
    .upsert(CATALOG_ROWS, { onConflict: 'sku', count: 'exact' })
    .select('sku');

  if (error) {
    console.error('seed failed:', error.message);
    process.exitCode = 1;
    return;
  }

  const { count: total, error: totalError } = await supabase
    .from('catalog_items')
    .select('sku', { count: 'exact', head: true });

  if (totalError) {
    console.error('post-seed count failed:', totalError.message);
    process.exitCode = 1;
    return;
  }

  console.log(`seeded ${count} rows in this run; catalog_items now holds ${total} items`);
}

void main();
