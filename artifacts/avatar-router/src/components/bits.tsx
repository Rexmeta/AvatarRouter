import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Mic, MicOff, RotateCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const tone: Record<string, string> = {
  available: 'ok', active: 'ok', ok: 'ok', ready: 'ok', true: 'ok', implemented: 'ok',
  degraded: 'warn', pending: 'warn', expired: 'warn', unconfigured: 'warn', 'not-installed': 'warn',
  unavailable: 'bad', failed: 'bad', error: 'bad', false: 'bad',
  ended: 'off',
};

export function Pill({ value, label, live }: { value: string; label?: string; live?: boolean }) {
  const k = tone[value.toLowerCase()] ?? (/(pend|not|unproven|unver)/i.test(value) ? 'warn' : 'off');
  const color =
    k === 'ok' ? 'hsl(var(--ok))' : k === 'warn' ? 'hsl(var(--warn))' : k === 'bad' ? 'hsl(var(--destructive))' : 'hsl(var(--off))';
  return (
    <span
      data-testid={`status-${value}`}
      className="mono inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[10.5px] uppercase tracking-wider"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 8%, transparent)` }}
    >
      <span className={cn('relative h-1.5 w-1.5 rounded-full', live && 'ping')} style={{ background: color, color }} />
      {label ?? value}
    </span>
  );
}

export function Panel({ children, className, title, aside }: { children: ReactNode; className?: string; title?: ReactNode; aside?: ReactNode }) {
  return (
    <section className={cn('rise rounded-md border border-card-border bg-card shadow-sm', className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-card-border px-4 py-2.5">
          <div className="eyebrow">{title}</div>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHead({ index, title, lede, right }: { index: string; title: string; lede: string; right?: ReactNode }) {
  return (
    <div className="rise mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <div className="eyebrow mb-2">{index}</div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{lede}</p>
      </div>
      {right}
    </div>
  );
}

export function Skel({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-muted', className)} />;
}

export function ErrorState({ onRetry, message }: { onRetry: () => void; message?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-5">
      <div className="text-sm font-medium text-destructive">{t('loadFail')}</div>
      {message && <div className="mono text-xs text-muted-foreground">{message}</div>}
      <button data-testid="button-retry" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs hover:bg-muted">
        <RotateCw className="h-3 w-3" /> {t('retry')}
      </button>
    </div>
  );
}

export function CopyBlock({ code, label }: { code: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch { /* clipboard blocked */ }
  };
  return (
    <div className="overflow-hidden rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-1.5">
        <span className="mono text-[10.5px] uppercase tracking-wider opacity-60">{label ?? 'shell'}</span>
        <button data-testid="button-copy" onClick={copy} className="mono inline-flex items-center gap-1 text-[11px] opacity-70 transition hover:opacity-100">
          {done ? <Check className="h-3 w-3 text-[hsl(var(--sidebar-primary))]" /> : <Copy className="h-3 w-3" />}
          {done ? t('copied') : t('copy')}
        </button>
      </div>
      <pre className="mono min-w-0 max-w-full overflow-x-auto p-3 text-[12px] leading-relaxed">{code}</pre>
    </div>
  );
}

export function Orb({ active, interruptPulse }: { active: boolean; interruptPulse: number }) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!interruptPulse) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 500);
    return () => clearTimeout(id);
  }, [interruptPulse]);
  return (
    <div className={cn('relative aspect-square w-full max-w-[320px]', !active && 'orb-idle')} data-testid="img-mock-orb">
      <svg viewBox="0 0 200 200" className="h-full w-full">
        <defs>
          <radialGradient id="core" cx="40%" cy="38%">
            <stop offset="0%" stopColor="hsl(42 90% 85%)" />
            <stop offset="45%" stopColor="hsl(12 86% 58%)" />
            <stop offset="100%" stopColor="hsl(196 45% 18%)" />
          </radialGradient>
        </defs>
        <g className="orb-ring" style={{ transformOrigin: '100px 100px' }}>
          <circle cx="100" cy="100" r="92" fill="none" stroke="hsl(var(--foreground) / .25)" strokeDasharray="2 6" />
          <circle cx="100" cy="8" r="3" fill="hsl(var(--primary))" />
        </g>
        <g className="orb-ring-rev" style={{ transformOrigin: '100px 100px' }}>
          <ellipse cx="100" cy="100" rx="78" ry="30" fill="none" stroke="hsl(176 45% 34% / .5)" />
          <ellipse cx="100" cy="100" rx="30" ry="78" fill="none" stroke="hsl(176 45% 34% / .3)" />
        </g>
        <g className="orb-core" style={{ transformOrigin: '100px 100px' }}>
          <circle cx="100" cy="100" r="54" fill="url(#core)" opacity={active ? 1 : 0.35} style={{ transition: 'opacity .6s' }} />
        </g>
      </svg>
      <div
        className="pointer-events-none absolute inset-[22%] rounded-full border-2 border-primary"
        style={{ opacity: flash ? 1 : 0, transform: flash ? 'scale(1.25)' : 'scale(.9)', transition: 'all .5s ease-out' }}
      />
    </div>
  );
}

export function MicCheck({ resetKey }: { resetKey?: string }) {
  const { t } = useI18n();
  const [level, setLevel] = useState(0);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState(false);
  const [pending, setPending] = useState(false);
  const attemptRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  const stop = () => {
    attemptRef.current++;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setOn(false);
    setLevel(0);
    setPending(false);
  };
  useEffect(() => stop, [resetKey]);

  const start = async () => {
    setErr(false);
    setPending(true);
    const attempt = ++attemptRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // A permission prompt can resolve after navigation or session termination.
      if (attempt !== attemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(s / buf.length) * 4));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      setOn(true);
      setPending(false);
    } catch {
      if (attempt !== attemptRef.current) return;
      setErr(true);
      stop();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          data-testid="button-mic"
          disabled={pending}
          onClick={on ? stop : start}
          className={cn(
            'inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm transition active:scale-[.97]',
            on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
          )}
        >
          {on ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {on ? t('mic.stop') : t('mic.start')}
        </button>
        <div className="flex h-6 flex-1 items-end gap-[3px]" data-testid="meter-mic">
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="w-full origin-bottom rounded-[1px] bg-[hsl(var(--chart-2))]"
              style={{ height: '100%', transform: `scaleY(${Math.max(0.08, level * 1.4 - i / 30)})`, opacity: level * 24 > i ? 1 : 0.25, transition: 'transform 60ms' }}
            />
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{err ? t('mic.denied') : t('mic.note')}</p>
    </div>
  );
}

export const fmtSec = (s: number) => {
  const m = Math.floor(s / 60);
  return m ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
};
export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export function errMsg(e: unknown): string {
  const d = (e as { data?: { error?: string; code?: string } })?.data;
  if (d?.error) return d.code ? `${d.error} (${d.code})` : d.error;
  return (e as Error)?.message ?? 'Unknown error';
}
