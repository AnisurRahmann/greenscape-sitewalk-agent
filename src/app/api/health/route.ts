import { getSupabaseAdmin } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

/** Liveness + database probe for uptime monitoring and deploy checks. */
export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  let database: 'up' | 'down' = 'down';
  let databaseError: string | null = null;
  try {
    const { error } = await getSupabaseAdmin()
      .from('proposals')
      .select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    database = 'up';
  } catch (err) {
    databaseError = err instanceof Error ? err.message : String(err);
  }

  const body = {
    status: database === 'up' ? 'ok' : 'degraded',
    checks: { database },
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
    ...(databaseError ? { databaseError } : {}),
  };

  return Response.json(body, { status: database === 'up' ? 200 : 503 });
}
