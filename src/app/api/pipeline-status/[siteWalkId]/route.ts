import { getSupabaseAdmin } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

/** Polling endpoint for pipeline progress: reads proposals.step_status. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siteWalkId: string }> },
): Promise<Response> {
  const { siteWalkId } = await params;

  const { data, error } = await getSupabaseAdmin()
    .from('proposals')
    .select('id, status, step_status')
    .eq('site_walk_id', siteWalkId)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return Response.json({ status: 'not_found' }, { status: 404 });
  }

  return Response.json({
    proposalId: data.id,
    status: data.status,
    stepStatus: data.step_status,
  });
}
