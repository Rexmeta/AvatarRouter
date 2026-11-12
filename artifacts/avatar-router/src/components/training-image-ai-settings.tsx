import { useGetSetup } from '@workspace/api-client-react';
import { RefreshCw, KeyRound } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function TrainingImageAISettings() {
  const { lang } = useI18n();
  const L = (en: string, ko: string) => lang === 'en' ? en : ko;
  const setup = useGetSetup({ query: { staleTime: 0, refetchOnMount: 'always', refetchInterval: 30000 } });
  const ai = setup.data?.trainingImageAI;
  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-4" aria-label={L('Training image AI configuration', '학습 이미지 Gemini 설정')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-primary" />{L('Training image · Gemini', '학습 이미지 · Gemini')}</h2>
        <button type="button" onClick={() => void setup.refetch()} disabled={setup.isFetching} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${setup.isFetching ? 'animate-spin' : ''}`} />{L('Refresh status', '설정 새로고침')}
        </button>
      </div>
      {setup.isLoading ? <p className="mt-3 text-sm text-muted-foreground">{L('Checking configuration…', '설정을 확인하고 있습니다…')}</p>
        : setup.isError ? <p role="alert" className="mt-3 text-sm text-amber-500">{L('Could not load server configuration. Retry refresh.', '서버 설정을 읽지 못했습니다. 새로고침해 주세요.')}</p>
        : !ai ? <p className="mt-3 text-sm text-amber-500">{L('This server does not report training AI settings yet. Publish the updated API and worker.', '이 서버는 아직 학습 AI 설정 정보를 제공하지 않습니다. 수정된 API와 워커를 게시하세요.')}</p>
        : <div className="mt-3 space-y-2 text-sm">
          <p>{ai.source === 'direct' ? L('Your Gemini API key', '직접 등록한 Gemini API 키') : ai.source === 'replit' ? L('Replit-managed Gemini', 'Replit 관리형 Gemini') : L('No Gemini connection', 'Gemini 미설정')}
            {' · '}<span className={ai.configured ? 'text-emerald-500' : 'text-amber-500'}>{ai.configured ? L('Configured · calls not verified', '설정됨 · 실제 호출 미검증') : L('Configuration required', '설정 필요')}</span></p>
          <p className="break-words font-mono text-xs text-muted-foreground">{L('Inspection', '검사')}: {ai.inspectionModel} / {L('Image', '재생성')}: {ai.imageModel}</p>
          {!ai.modelConfigValid && <p role="alert" className="text-amber-500">{L('Training model environment variables are invalid.', '학습 모델 환경변수의 이름 형식이 올바르지 않습니다.')}</p>}
        </div>}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{L(
        'Every custom creation: seed check → Gemini generates a provider-specific image → normalization and identity/framing verification → avatar provider → completion after provider confirmation. No resize-only fallback. Calls use the selected account’s billing and limits.',
        '모든 커스텀 생성: 시드 검사 → Gemini로 제공자별 이미지 생성 → 규격 정규화·얼굴·구도 검증 → 아바타 제공자 전송 → 제공자 확인 후 완료 안내. 단순 리사이즈 대체는 하지 않습니다. 선택된 연결 계정의 비용과 한도가 적용됩니다.',
      )}</p>
      <details className="mt-3 border-t border-border pt-3 text-xs">
        <summary className="cursor-pointer font-medium text-primary">{L('How to enter a Gemini API key securely', 'Gemini API 키 안전하게 입력하는 방법')}</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 leading-relaxed text-muted-foreground">
          <li>{L('Router server operator: open Replit Tools → Secrets and add ', '라우터 서버 운영자: Replit Tools → Secrets에서 ')}<code className="text-foreground">GEMINI_API_KEY</code>{L(' with your Google AI Studio key.', '에 Google AI Studio 키를 입력하세요.')}</li>
          <li>{L('Restart API and Renderer Worker. For a published service, check Production app secrets and republish.', 'API와 Renderer Worker를 다시 시작하세요. 게시된 서비스는 Production app secrets도 확인하고 다시 게시하세요.')}</li>
          <li>{L('Refresh status here. Presence does not verify authentication, quota or successful image generation.', '이 화면에서 설정을 새로고침하세요. 키가 있다는 사실은 인증·할당량·이미지 생성 성공을 검증하지 않습니다.')}</li>
        </ol>
        <p className="mt-3 leading-relaxed text-muted-foreground">{L('Optional model settings', '선택 모델 설정')}: <code>GEMINI_TRAINING_INSPECTION_MODEL</code>, <code>GEMINI_TRAINING_IMAGE_MODEL</code>.</p>
        <p className="mt-2 leading-relaxed text-muted-foreground">{L(
          'A direct key takes priority and never falls back to Replit billing on failure. Removing that server secret restores the managed connection when configured. Do not put Gemini keys into RoleplayX, chat, or browser storage.',
          '직접 키가 우선하며, 실패해도 Replit 과금으로 자동 전환하지 않습니다. 해당 서버 시크릿을 제거하면 설정된 관리형 연결로 돌아갑니다. Gemini 키를 RoleplayX·채팅·브라우저 저장소에 넣지 마세요.',
        )}</p>
      </details>
    </section>
  );
}
