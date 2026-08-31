'use client';

import { useState, useTransition } from 'react';

import { submitSitewalk } from '@/app/(app)/new/actions';
import { AudioRecorder } from '@/components/ingest/audio-recorder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { SubmitSitewalkResult } from '@/lib/ingest/schema';

export function NewSitewalkForm() {
  const [mode, setMode] = useState<'audio' | 'text'>('audio');
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [lead, setLead] = useState({ fullName: '', phone: '', email: '', address: '' });
  const [result, setResult] = useState<SubmitSitewalkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const setLeadField = (field: keyof typeof lead) => (value: string) =>
    setLead((prev) => ({ ...prev, [field]: value }));

  const canSubmit =
    lead.fullName.trim().length > 0 && (mode === 'text' ? transcript.trim().length > 0 : !!audioPath);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (mode === 'audio' && !audioPath) {
      setError('Record or upload the audio first.');
      return;
    }
    startTransition(async () => {
      const outcome = await submitSitewalk(
        mode === 'audio'
          ? { inputMode: 'audio', lead, audioPath: audioPath! }
          : { inputMode: 'text', lead, transcript },
      );
      if (outcome.ok) {
        setResult(outcome);
      } else {
        setError(outcome.error ?? 'Something went wrong.');
      }
    });
  };

  if (result?.ok) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-emerald-600/30 bg-emerald-600/5 p-6">
        <h2 className="text-lg font-semibold">Site walk captured</h2>
        <p className="text-sm text-muted-foreground">
          {mode === 'audio'
            ? 'Audio received — transcription is running in the background.'
            : 'Typed notes stored directly — no transcription needed.'}
        </p>
        <p className="font-mono text-xs text-muted-foreground">site_walk {result.siteWalkId}</p>
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          Start another
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">Lead details</h2>
        <div className="flex flex-col gap-3">
          <Label htmlFor="fullName">Name *</Label>
          <Input
            id="fullName"
            required
            autoComplete="name"
            value={lead.fullName}
            onChange={(e) => setLeadField('fullName')(e.target.value)}
          />
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={lead.phone}
            onChange={(e) => setLeadField('phone')(e.target.value)}
          />
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={lead.email}
            onChange={(e) => setLeadField('email')(e.target.value)}
          />
          <Label htmlFor="address">Address</Label>
          <Input
            id="address"
            autoComplete="street-address"
            value={lead.address}
            onChange={(e) => setLeadField('address')(e.target.value)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Site-walk notes</h2>
        <Tabs value={mode} onValueChange={(value) => setMode(value as 'audio' | 'text')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="audio">Record / upload</TabsTrigger>
            <TabsTrigger value="text">Type or paste</TabsTrigger>
          </TabsList>
          <TabsContent value="audio" className="mt-3">
            <AudioRecorder onUploaded={setAudioPath} disabled={isPending} />
            <p className="mt-2 text-xs text-muted-foreground">
              Whisper transcription runs after upload — you can close this page.
            </p>
          </TabsContent>
          <TabsContent value="text" className="mt-3">
            <Textarea
              rows={10}
              placeholder="Paste or type the walk notes exactly as spoken…"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              disabled={isPending}
            />
          </TabsContent>
        </Tabs>
      </section>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={!canSubmit || isPending} className="h-12 w-full text-base">
        {isPending ? 'Saving…' : 'Save site walk'}
      </Button>
    </form>
  );
}
