import type { ReactNode } from 'react';
import { ProviderFailureNotice } from './provider-failure-notice';
import { AlertTriangle, Play, RotateCw, Square, Volume2 } from 'lucide-react';
import type { LiveCheckView } from '../lib/workspace-live-check-view';
import { Panel, Pill, Skel, fmtTime } from './bits';
import { LiveAdmissionNotice } from './live-admission-notice';
import { PageHead } from './bits';
import { useI18n } from '@/lib/i18n';

const PHASES: LiveCheckView['phase'][] = ['idle', 'creating', 'waiting', 'connecting', 'observing', 'stopping', 'finished'];

function Row({ label, children, testid }: { label: string; children: ReactNode; testid: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-card-border px-4 py-2.5 last:border-b-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mono text-right text-xs" data-testid={testid}>{children}</dd>
  </div>;
}

export function WorkspaceLiveCheckPanel({ check }: { check: LiveCheckView }) {
  const { lang } = useI18n();
  const t = (en: string, ko: string) => lang === 'ko' ? ko : en;
  const s = check.state;
  const session = s?.session ?? null;
  const limits = s?.limits;
  const reasons = limits?.blockingReasons ?? [];
  const unresolved = !!limits?.cleanupPending || !!session?.cleanupPending || reasons.some(r => /reconcil|cleanup_pending/i.test(r));
  const active = ['creating', 'waiting', 'connecting', 'observing', 'stopping'].includes(check.phase);
  const recovered = !!session && !active && !s?.cleanupConfirmed;
  const heardAllowed = check.sampleCompleted && check.audioBytes > 0 && !check.playbackBlocked;
  const phaseIdx = PHASES.indexOf(check.phase);

  return <div data-testid="section-live-check">
    <PageHead index="WORKSPACE / LIVE-CHECK" title={t('Live media check', '라이브 미디어 점검')} lede={t('One bounded stock-avatar session to confirm video and audio transport reach this browser. It does not certify custom avatars.', '스톡 아바타로 한 번의 제한된 세션을 열어 영상·음성 전송이 이 브라우저에 도달하는지 확인합니다. 커스텀 아바타를 인증하지 않습니다.')}
      right={<button data-testid="button-refresh-live-check" className="arw-button" disabled={check.busy || check.loading} onClick={check.refresh}><RotateCw size={14}/>{t('Refresh status', '상태 새로고침')}</button>}/>
    {limits && <LiveAdmissionNotice limits={limits}/>}

    {check.error && <div role="alert" data-testid="text-live-check-error" className="console-note console-warning flex items-start gap-3"><AlertTriangle size={18} className="shrink-0"/><span>{check.error}</span></div>}

    {unresolved && <div role="alert" data-testid="status-cleanup-unresolved" className="console-note console-warning flex items-start gap-3"><AlertTriangle size={18} className="shrink-0"/><div><strong>{t('Unresolved cleanup blocks new checks', '미해결 정리로 새 점검이 차단됨')}</strong><p className="mt-1">{t('The server reports reconciliation or cleanup pending. An operator must resolve it; refreshing does not clear the block.', '서버가 대조·정리 대기 상태를 보고했습니다. 운영자 처리가 필요하며 새로고침으로 해제되지 않습니다.')}</p>{reasons.length > 0 && <span className="mono text-xs">{reasons.join(', ')}</span>}</div></div>}

    {recovered && <div data-testid="status-recovered-session" className="console-note console-warning">
      <strong>{t('Previous check session found', '이전 점검 세션이 남아 있습니다')}</strong>
      <p className="mt-1">{t('Browser evidence from before a reload is lost. This session will not be reconnected or replayed; end it to release resources.', '새로고침 이전의 브라우저 증거는 사라졌습니다. 이 세션은 다시 연결·재생하지 않으며, 종료해 자원을 해제해야 합니다.')}</p>
      {s?.sampleAttempted && <p className="mt-1 text-xs" data-testid="text-sample-attempted">{t('Server recorded that a tone sample was attempted. Completion cannot be confirmed without local evidence.', '서버에 톤 샘플 시도가 기록되어 있습니다. 로컬 증거 없이 완료 여부는 확인할 수 없습니다.')}</p>}
      <button data-testid="button-end-recovered" className="arw-button mt-3" disabled={check.busy} onClick={check.stop}><Square size={14}/>{t('End session', '세션 종료')}</button>
    </div>}

    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-6">
        <Panel title={t('Before you start', '시작 전 확인')}>
          <ul className="space-y-2 p-4 text-sm">
            <li>{t('Uses paid Tavus and LiveKit resources. Cost is unknown and nothing here is a quote.', 'Tavus·LiveKit 유료 자원을 사용합니다. 비용은 알 수 없으며 견적이 아닙니다.')}</li>
            <li>{t('Hard server deadline: 120 seconds total, including startup.', '서버 최종 기한: 시작 포함 총 120초.')}</li>
            <li>{t('Plays a 1-second synthetic tone. Not speech, no microphone, no AI conversation.', '1초 합성 톤을 재생합니다. 음성 발화·마이크·AI 대화 없음.')}</li>
            <li>{t('No new avatar training. Observation is bounded, then the session ends automatically.', '새 아바타 학습 없음. 관찰은 제한 시간 후 자동 종료됩니다.')}</li>
            <li>{t('Expiry requests termination; it is not a billing guarantee. Charges may continue until remote cleanup is confirmed.', '만료는 종료 요청 기준이며 청구 상한 보장이 아닙니다. 원격 정리가 확인될 때까지 비용이 계속 발생할 수 있습니다.')}</li>
          </ul>
          <div className="border-t border-card-border p-4">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" data-testid="checkbox-live-check-consent" className="mt-1" checked={check.consent} disabled={active || check.busy} onChange={e => check.setConsent(e.target.checked)}/>
              <span>{t('I accept unknown Tavus/LiveKit costs and the 120-second total session limit.', '알 수 없는 Tavus·LiveKit 비용과 총 120초 세션 제한에 동의합니다.')}</span>
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <button data-testid="button-start-live-check" className="arw-button primary" disabled={!check.canStart || check.busy} onClick={check.start}><Play size={14}/>{check.busy && check.phase === 'creating' ? t('Starting…', '시작 중…') : t('Start check', '점검 시작')}</button>
              {active && <button data-testid="button-stop-live-check" className="arw-button" disabled={check.phase === 'stopping'} onClick={check.stop}><Square size={14}/>{t('Stop', '중지')}</button>}
            </div>
            {!check.canStart && !active && <p className="mt-2 text-xs text-muted-foreground" data-testid="text-start-blocked">{t('Start unavailable: consent required, or the server is not admitting a new check.', '시작 불가: 동의가 필요하거나 서버가 새 점검을 허용하지 않습니다.')}</p>}
          </div>
        </Panel>

        <Panel title={t('Phase', '단계')} aside={<Pill value={check.phase} live={active}/>}>
          <ol className="flex flex-wrap gap-1.5 p-4" data-testid="status-live-check-phase">
            {PHASES.map((p, i) => <li key={p} className={`mono rounded-sm border px-2 py-0.5 text-[10.5px] uppercase ${i === phaseIdx ? 'border-primary text-primary' : i < phaseIdx ? 'opacity-70' : 'opacity-35'}`}>{p}</li>)}
          </ol>
        </Panel>

        <Panel title={t('Media', '미디어')}>
          <div className="p-4">
            <video ref={check.videoRef} data-testid="video-live-check" muted playsInline autoPlay className="aspect-video w-full rounded bg-sidebar"/>
            <audio ref={check.audioRef} data-testid="audio-live-check" autoPlay/>
            {check.playbackBlocked && <button data-testid="button-enable-audio" className="arw-button mt-3" onClick={check.enableAudio}><Volume2 size={14}/>{t('Enable audio playback', '오디오 재생 허용')}</button>}
          </div>
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title={t('Server state', '서버 상태')}>
          {check.loading ? <div className="p-4"><Skel className="h-24"/></div> : <dl>
            <Row label={t('Session', '세션')} testid="text-session-id">{session?.id ?? t('none', '없음')}</Row>
            <Row label={t('Status', '상태')} testid="text-session-status">{session ? <Pill value={session.status}/> : '—'}</Row>
            <Row label={t('Renderer state (server-reported)', '렌더러 상태 (서버 보고)')} testid="text-renderer-state">{session?.rendererState ?? '—'}</Row>
            {session?.error && <Row label={t('Session error code', '세션 오류 코드')} testid="text-session-error">{session.error}</Row>}
            <ProviderFailureNotice failure={session?.failure} />
            <Row label={t('Started', '시작')} testid="text-session-started">{fmtTime(session?.startedAt)}</Row>
            <Row label={t('Sample attempted (server)', '샘플 시도 (서버)')} testid="text-server-sample-attempted">{s ? String(s.sampleAttempted) : '—'}</Row>
            <Row label={t('Cleanup confirmed', '정리 확인')} testid="status-cleanup-confirmed">{!session ? t('no session · no prior check', '세션 없음 · 이전 점검 없음') : s?.cleanupConfirmed ? <Pill value="ok" label={t('confirmed', '확인됨')}/> : <Pill value="pending" label={t('not confirmed', '미확인')}/>}</Row>
          </dl>}
        </Panel>

        <Panel title={t('Browser evidence (this tab only)', '브라우저 증거 (현재 탭)')}>
          <dl>
            <Row label={t('Decoded video frames', '디코딩된 영상 프레임')} testid="text-video-frames">{check.videoFrames}</Row>
            <Row label={t('Audio bytes received', '수신 오디오 바이트')} testid="text-audio-bytes">{check.audioBytes}</Row>
            <Row label={t('Audio energy', '오디오 에너지')} testid="text-audio-energy">{check.audioEnergy.toFixed(4)}</Row>
            <Row label={t('Tone sample completed', '톤 샘플 완료')} testid="status-sample-completed">{String(check.sampleCompleted)}</Row>
            <Row label={t('Playback blocked', '재생 차단')} testid="status-playback-blocked">{String(check.playbackBlocked)}</Row>
          </dl>
          <p className="px-4 pb-3 text-xs text-muted-foreground">{t('Receiving transport or frames is separate from sample completion. Lost on reload.', '전송·프레임 수신은 샘플 완료와 별개입니다. 새로고침 시 사라집니다.')}</p>
        </Panel>

        <Panel title={t('Human attestation', '사람 확인')}>
          <div className="p-4">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" data-testid="checkbox-heard" className="mt-1" checked={check.heard} disabled={!heardAllowed} onChange={e => check.setHeard(e.target.checked)}/>
              <span>{t('I heard a tone through this browser.', '이 브라우저에서 톤을 들었습니다.')}</span>
            </label>
            <p className="mt-2 text-xs text-muted-foreground">{t('Manual statement only. The system does not recognize audio content.', '수동 진술일 뿐이며 시스템은 오디오 내용을 인식하지 않습니다.')}</p>
          </div>
        </Panel>

        <Panel title={t('Summary', '요약')}>
          <ul className="space-y-1.5 p-4 text-xs" data-testid="text-live-check-summary">
            <li>{t('Media sample', '미디어 샘플')}: {check.sampleCompleted ? t('completed', '완료') : t('incomplete', '미완료')}</li>
            <li>{t('Browser video frames', '브라우저 영상 프레임')}: {check.videoFrames > 0 ? t('observed', '관측됨') : t('not observed', '관측 안 됨')}</li>
            <li>{t('Browser audio transport', '브라우저 오디오 전송')}: {check.audioBytes > 0 ? t('observed (not proof of audible sound)', '관측됨 (실제 청취 증거 아님)') : t('not observed', '관측 안 됨')}</li>
            <li>{t('Heard (human)', '청취 (사람)')}: {check.heard ? t('attested', '확인함') : t('not attested', '미확인')}</li>
            <li className="text-muted-foreground">{t('Stock-avatar check only; says nothing about custom avatars.', '스톡 아바타 점검이며 커스텀 아바타를 보증하지 않습니다.')}</li>
          </ul>
        </Panel>
      </div>
    </div>
  </div>;
}
