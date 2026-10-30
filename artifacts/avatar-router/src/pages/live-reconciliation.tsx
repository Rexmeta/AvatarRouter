import { useForm } from 'react-hook-form';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Check, Clock3, ShieldCheck } from 'lucide-react';
import {
  getListLiveReconciliationQueryKey,
  useAttachLiveConversationId,
  useListLiveReconciliation,
} from '@workspace/api-client-react';
import { ErrorState, PageHead, Panel, Pill, Skel, fmtTime } from '@/components/bits';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useI18n } from '@/lib/i18n';

function errorStatus(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: number }).status
    : undefined;
}

function AccessDenied() {
  const { t } = useI18n();
  return (
    <section className="rise rounded-md border border-destructive/30 bg-destructive/5 p-6 md:p-8" data-testid="state-access-denied" role="alert">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded border border-destructive/25 bg-card text-destructive">
        <ShieldCheck className="h-5 w-5" />
      </div>
      <div className="eyebrow text-destructive">403 / operator-only</div>
      <h2 className="mt-2 text-2xl font-bold tracking-tight">{t('recon.accessDenied')}</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground" data-testid="text-access-denied-note">{t('recon.accessDeniedNote')}</p>
    </section>
  );
}

function SignInInvitation() {
  const { t } = useI18n();
  return (
    <section className="rise rounded-md border border-card-border bg-card p-6 shadow-sm md:p-8" data-testid="state-sign-in-invitation">
      <div className="eyebrow mb-2">AUTH / REQUIRED</div>
      <h2 className="text-2xl font-bold tracking-tight">{t('recon.signIn')}</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{t('recon.signInNote')}</p>
      <Link href="/sign-in" data-testid="link-reconciliation-sign-in" className="mt-5 inline-flex items-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95">
        {t('recon.signIn')} <ArrowUpRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

function PendingSession({ sessionId, roomName, startedAt, expiresAt, rendererState, providerCreateState }: {
  sessionId: string;
  roomName: string | null;
  startedAt: string;
  expiresAt: string;
  rendererState: string;
  providerCreateState: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const form = useForm<{ providerConversationId: string; confirmedFromProvider: boolean }>({
    defaultValues: { providerConversationId: '', confirmedFromProvider: false },
    mode: 'onChange',
  });
  const attach = useAttachLiveConversationId({ mutation: { gcTime: 0 } });

  const submit = (values: { providerConversationId: string; confirmedFromProvider: boolean }) => {
    attach.mutate(
      { id: sessionId, data: { providerConversationId: values.providerConversationId, confirmedFromProvider: true } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListLiveReconciliationQueryKey() }) },
    );
  };

  return (
    <article className="border-b border-card-border last:border-b-0" data-testid={`card-reconciliation-session-${sessionId}`}>
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.85fr)] lg:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono break-all text-[12px] font-medium" data-testid={`text-session-id-${sessionId}`}>{sessionId}</span>
            <Pill value="reconciliation_required" label="unresolved" />
          </div>
          <div className="mt-2 text-sm font-semibold" data-testid={`text-room-name-${sessionId}`}>{roomName ?? 'Room name unavailable'}</div>
          <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-xs sm:grid-cols-4">
            <div><dt className="eyebrow">{t('recon.started')}</dt><dd className="mt-1" data-testid={`text-started-at-${sessionId}`}>{fmtTime(startedAt)}</dd></div>
            <div><dt className="eyebrow">{t('recon.expires')}</dt><dd className="mt-1" data-testid={`text-expires-at-${sessionId}`}>{fmtTime(expiresAt)}</dd></div>
            <div><dt className="eyebrow">{t('recon.renderer')}</dt><dd className="mt-1" data-testid={`status-renderer-${sessionId}`}><Pill value={rendererState} /></dd></div>
            <div><dt className="eyebrow">{t('recon.provider')}</dt><dd className="mt-1" data-testid={`status-provider-create-${sessionId}`}><Pill value={providerCreateState} /></dd></div>
          </dl>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="rounded border border-border bg-background/70 p-3.5" data-testid={`form-attach-conversation-${sessionId}`}>
            <FormField
              control={form.control}
              name="providerConversationId"
              rules={{
                required: 'A provider conversation ID is required.',
                maxLength: { value: 200, message: 'The ID must be 200 characters or fewer.' },
                pattern: { value: /^[A-Za-z0-9._:-]+$/, message: 'Use only letters, numbers, periods, underscores, colons, or hyphens.' },
              }}
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormLabel className="eyebrow block">{t('recon.providerId')}</FormLabel>
                  <FormControl>
                    <input
                      {...field}
                      data-testid={`input-provider-conversation-id-${sessionId}`}
                      placeholder="cv_…"
                      autoComplete="off"
                      maxLength={200}
                      disabled={attach.isPending || attach.isSuccess}
                      className="mono mt-2 w-full rounded border border-input bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
                    />
                  </FormControl>
                  <FormDescription className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground" data-testid={`text-provider-id-hint-${sessionId}`}>{t('recon.providerHint')}</FormDescription>
                  <FormMessage data-testid={`text-provider-id-error-${sessionId}`} className="mt-1 text-[11px]" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmedFromProvider"
              rules={{ validate: (value) => value || t('recon.attestRequired') }}
              render={({ field }) => (
                <FormItem className="mt-3 space-y-0">
                  <div className="flex items-start gap-2.5">
                    <FormControl>
                      <input
                        type="checkbox"
                        data-testid={`input-provider-attestation-${sessionId}`}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        checked={field.value}
                        onChange={field.onChange}
                        disabled={attach.isPending || attach.isSuccess}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                      />
                    </FormControl>
                    <FormLabel className="cursor-pointer text-xs font-normal leading-relaxed">{t('recon.attest')}</FormLabel>
                  </div>
                  <FormMessage data-testid={`text-provider-attestation-error-${sessionId}`} className="mt-1 text-[11px]" />
                </FormItem>
              )}
            />
          <button
            type="submit"
            data-testid={`button-attach-conversation-${sessionId}`}
            disabled={!form.formState.isValid || attach.isPending || attach.isSuccess}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {attach.isPending ? <><Clock3 className="h-3.5 w-3.5 animate-pulse" />{t('recon.pendingMutation')}</> : <>{t('recon.attach')} <ArrowUpRight className="h-3.5 w-3.5" /></>}
          </button>
          {attach.isError && <p role="alert" className="mt-2 rounded border border-destructive/25 bg-destructive/5 p-2 text-xs text-destructive" data-testid={`text-attach-error-${sessionId}`}>Attachment failed: {(attach.error as Error)?.message ?? 'Unknown error'}</p>}
          {attach.isSuccess && (
            <div role="status" className="mt-2 flex gap-2 rounded border border-[hsl(var(--ok)/.3)] bg-[hsl(var(--ok)/.06)] p-2 text-xs leading-relaxed text-[hsl(var(--ok))]" data-testid={`status-attachment-success-${sessionId}`}>
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {t('recon.success')}
                <span className="mono mt-1 block text-[10px] uppercase tracking-wider" data-testid={`text-cleanup-result-${sessionId}`}>
                  {attach.data.rendererState} · cleanup requested: {String(attach.data.cleanupRequested)}
                </span>
              </span>
            </div>
          )}
          </form>
        </Form>
      </div>
    </article>
  );
}

export default function LiveReconciliation() {
  const { t } = useI18n();
  const { isLoaded, isSignedIn } = useAuth();
  const query = useListLiveReconciliation({
    query: {
      enabled: isLoaded && !!isSignedIn,
      queryKey: getListLiveReconciliationQueryKey(),
      refetchInterval: 10000,
    },
  });

  if (isLoaded && !isSignedIn) {
    return <div><PageHead index="OPS / 01" title={t('recon.title')} lede={t('recon.lede')} /><SignInInvitation /></div>;
  }

  if (!isLoaded || query.isLoading) {
    return (
      <div>
        <PageHead index="OPS / 01" title={t('recon.title')} lede={t('recon.lede')} />
        <div className="space-y-3" aria-label="Loading reconciliation data" data-testid="state-reconciliation-loading">
          <Skel className="h-24" />
          <Skel className="h-44" />
          <Skel className="h-44" />
        </div>
      </div>
    );
  }

  if (query.isError && errorStatus(query.error) === 403) {
    return <div><PageHead index="OPS / 01" title={t('recon.title')} lede={t('recon.lede')} /><AccessDenied /></div>;
  }

  return (
    <div>
      <PageHead
        index="OPS / 01 · TRUSTED MAINTAINER"
        title={t('recon.title')}
        lede={t('recon.lede')}
        right={<div className="mono flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="status-polling"><span className="relative h-2 w-2 rounded-full bg-[hsl(var(--ok))]" />Refreshing every 10 seconds</div>}
      />

      <section className="rise mb-6 grid gap-3 rounded-md border border-[hsl(var(--warn)/.35)] bg-[hsl(var(--warn)/.07)] p-4 md:grid-cols-[auto_1fr] md:items-start md:p-5" data-testid="notice-cleanup-boundary">
        <div className="flex h-9 w-9 items-center justify-center rounded border border-[hsl(var(--warn)/.28)] bg-card/70 text-[hsl(var(--warn))]">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div>
          <div className="eyebrow text-[hsl(var(--warn))]">{t('recon.boundary')}</div>
          <p className="mt-1 text-sm font-semibold leading-relaxed" data-testid="text-cleanup-boundary">{t('recon.boundaryNote')}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Attaching an ID only queues existing worker cleanup. It does not force-close the provider session or clear its warning.</p>
        </div>
      </section>

      {query.isError ? (
        <div className="mb-6" data-testid="state-reconciliation-error">
          <ErrorState message={(query.error as Error)?.message ?? t('recon.loadError')} onRetry={() => query.refetch()} />
        </div>
      ) : null}

      <div className="grid gap-6">
        <Panel title={<span>{t('recon.pending')} <span className="mono ml-1 text-muted-foreground" data-testid="text-pending-count">{query.data?.pending.length ?? 0}</span></span>} aside={<span className="mono text-[10px] text-muted-foreground">SERVER AUTHORITY</span>}>
          {query.data?.pending.length ? (
            <div data-testid="list-pending-reconciliation">
              {query.data.pending.map((session) => <PendingSession key={session.id} sessionId={session.id} roomName={session.roomName} startedAt={session.startedAt} expiresAt={session.expiresAt} rendererState={session.rendererState} providerCreateState={session.providerCreateState} />)}
            </div>
          ) : !query.isError ? (
            <div className="flex items-center gap-3 px-5 py-8" data-testid="state-pending-empty">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground"><Check className="h-4 w-4" /></div>
              <div><p className="text-sm font-semibold">{t('recon.emptyPending')}</p><p className="mono mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">No action available</p></div>
            </div>
          ) : null}
        </Panel>

        <Panel title={t('recon.audit')} aside={<span className="mono text-[10px] text-muted-foreground">APPEND-ONLY RECORDS</span>}>
          {query.data?.recentAudit.length ? (
            <div className="overflow-x-auto" data-testid="list-reconciliation-audit">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-muted/55 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('recon.created')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('recon.id')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('recon.operator')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('recon.action')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('recon.conversation')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {query.data.recentAudit.map((record) => (
                    <tr key={record.id} data-testid={`row-audit-${record.id}`} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground" data-testid={`text-audit-created-${record.id}`}>{fmtTime(record.createdAt)}</td>
                      <td className="mono max-w-48 truncate px-4 py-3" title={record.sessionId} data-testid={`text-audit-session-${record.id}`}>{record.sessionId}</td>
                      <td className="mono max-w-48 truncate px-4 py-3 text-muted-foreground" title={record.operatorUserId} data-testid={`text-audit-operator-${record.id}`}>{record.operatorUserId}</td>
                      <td className="px-4 py-3"><span data-testid={`status-audit-action-${record.id}`}><Pill value={record.action} /></span></td>
                      <td className="mono max-w-56 truncate px-4 py-3" title={record.providerConversationId} data-testid={`text-audit-conversation-${record.id}`}>{record.providerConversationId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !query.isError ? (
            <p className="px-5 py-8 text-sm text-muted-foreground" data-testid="state-audit-empty">{t('recon.emptyAudit')}</p>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
