'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { createSignedSitewalkUpload } from '@/app/(app)/new/actions';

interface AudioRecorderProps {
  onUploaded: (path: string) => void;
  disabled?: boolean;
}

type RecorderState =
  | { phase: 'idle' }
  | { phase: 'recording'; startedAt: number }
  | { phase: 'uploading' }
  | { phase: 'ready'; path: string }
  | { phase: 'error'; message: string };

const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
}

function formatElapsed(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function AudioRecorder({ onUploaded, disabled }: AudioRecorderProps) {
  const [state, setState] = useState<RecorderState>({ phase: 'idle' });
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  const cleanupTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => cleanupTimer, [cleanupTimer]);

  const upload = useCallback(
    async (blob: Blob, mimeType: string) => {
      setState({ phase: 'uploading' });
      try {
        const signed = await createSignedSitewalkUpload(extensionFor(mimeType));
        if (!signed.ok || !signed.signedUrl || !signed.path) {
          throw new Error(signed.error ?? 'could not create upload URL');
        }
        const response = await fetch(signed.signedUrl, {
          method: 'PUT',
          body: blob,
          headers: { 'content-type': mimeType },
        });
        if (!response.ok) throw new Error(`upload failed (${response.status})`);
        setState({ phase: 'ready', path: signed.path });
        onUploaded(signed.path);
      } catch (err) {
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : 'upload failed',
        });
      }
    },
    [onUploaded],
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        cleanupTimer();
        const type = recorder.mimeType || mimeType || 'audio/webm';
        void upload(new Blob(chunksRef.current, { type }), type);
      };

      recorder.start();
      recorderRef.current = recorder;
      setElapsed(0);
      startedAtRef.current = Date.now();
      setState({ phase: 'recording', startedAt: startedAtRef.current });
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
    } catch (err) {
      setState({
        phase: 'error',
        message:
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Microphone permission denied — use upload or typed notes instead.'
            : err instanceof Error
              ? err.message
              : 'could not start recording',
      });
    }
  }, [cleanupTimer, upload]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const onFileSelected = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      void upload(file, file.type || 'audio/webm');
    },
    [upload],
  );

  if (state.phase === 'recording') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-center gap-2 text-lg font-medium tabular-nums">
          <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden />
          {formatElapsed(elapsed)}
        </div>
        <Button type="button" variant="destructive" onClick={stopRecording} className="w-full">
          Stop recording
        </Button>
      </div>
    );
  }

  if (state.phase === 'uploading') {
    return (
      <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
        Uploading recording…
      </div>
    );
  }

  if (state.phase === 'ready') {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-emerald-600/30 bg-emerald-600/5 p-4 text-sm">
        <span>Recording uploaded.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setState({ phase: 'idle' })}
        >
          Record a different take
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.phase === 'error' && (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      )}
      <Button
        type="button"
        disabled={disabled}
        onClick={() => void startRecording()}
        className="h-12 w-full text-base"
      >
        Start recording
      </Button>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">or</span>
        <label className="flex-1">
          <input
            type="file"
            accept="audio/*"
            className="w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium"
            disabled={disabled}
            onChange={(event) => onFileSelected(event.target.files?.[0])}
          />
        </label>
      </div>
    </div>
  );
}
