import type { Metadata } from 'next';

import { NewSitewalkForm } from '@/components/ingest/new-sitewalk-form';

export const metadata: Metadata = {
  title: 'New site walk — Greenscape Pro',
};

export default function NewSitewalkPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New site walk</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture the lead, record or paste the walk notes, and the agent takes
          it from there.
        </p>
      </header>
      <NewSitewalkForm />
    </div>
  );
}
