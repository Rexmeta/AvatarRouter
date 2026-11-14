import { useGetSetup, useCheckTrainingImageModels } from '@workspace/api-client-react';
import { RefreshCw, KeyRound } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function TrainingImageAISettings() {
  const { lang } = useI18n();
  const L = (en: string, ko: string) => lang === 'en' ? en : ko;
  const setup = useGetSetup({ query: { staleTime: 0, refetchOnMount: 'always', refetchInterval: 30000 } });
  const ai = setup.data?.trainingImageAI;
  const diagnostic = useCheckTrainingImageModels({ query: { enabled: false, retry: false, gcTime: 0 } });
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
            {' · '}<span className="text-amber-500">{ai.configured ? L('Key configured · generation not verified', '키 설정됨 · 생성 성공 미검증') : L('Configuration required', '설정 필요')}</span></p>
          <p className="break-words font-mono text-xs text-muted-foreground">{L('Inspection', '검사')}: {ai.inspectionModel} / {L('Image', '재생성')}: {ai.imageModel}</p>
          <p className="text-xs text-muted-foreground">{L('This is configuration status, not a connection test or an error. Inspection and final verification use the inspection model; only regeneration uses the image model. A 404 during inspection does not mean the image model failed.', '이 표시는 설정 상태이며 연결 테스트 결과나 오류가 아닙니다. 시드 검사·최종 검증은 검사 모델을, 이미지 재생성만 이미지 모델을 사용합니다. 검사 단계의 404는 이미지 생성 모델의 실패를 뜻하지 않습니다.')}</p>
          {!ai.modelConfigValid && <p role="alert" className="text-amber-500">{L('Training model environment variables are invalid.', '학습 모델 환경변수의 이름 형식이 올바르지 않습니다.')}</p>}
        </div>}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{L(
        'Every custom creation: seed check → Gemini generates a provider-specific image → normalization and identity/framing verification → avatar provider → completion after provider confirmation. No resize-only fallback. Calls use the selected account’s billing and limits.',
        '모든 커스텀 생성: 시드 검사 → Gemini로 제공자별 이미지 생성 → 규격 정규화·얼굴·구도 검증 → 아바타 제공자 전송 → 제공자 확인 후 완료 안내. 단순 리사이즈 대체는 하지 않습니다. 선택된 연결 계정의 비용과 한도가 적용됩니다.',
      )}</p>
      <div className="mt-3 border-t border-border pt-3 text-xs">
        <button type="button" disabled={diagnostic.isFetching}
          onClick={() => void diagnostic.refetch()}
          className="rounded border border-border px-3 py-2 font-medium disabled:opacity-50">
          {diagnostic.isFetching ? L('Checking models…', '모델 확인 중…') : L('Check model access', '모델 접근 진단')}
        </button>
        <p className="mt-2 text-muted-foreground">{L(
          'Trusted router operator only. Reads model metadata using this server’s credential; sends no images and creates no avatar. Success does not verify generation or quota.',
          '라우터 운영자 전용입니다. 현재 서버의 키로 모델 정보만 조회하며 이미지 전송·아바타 생성은 하지 않습니다. 성공해도 실제 생성·할당량이 검증된 것은 아닙니다.',
        )}</p>
        {diagnostic.isError && <p role="alert" className="mt-2 text-amber-500">{L(
          'Model diagnostics could not be loaded. A trusted operator login and the updated router API are required.',
          '모델 진단을 불러오지 못했습니다. 운영자 권한으로 로그인했는지, 수정된 라우터 API가 게시됐는지 확인하세요.',
        )}</p>}
        {diagnostic.data && !diagnostic.isFetching && !diagnostic.isError && <div className="mt-2 space-y-2" role="status">
          <p>{L('API build', 'API 실행 버전')}: <code>{diagnostic.data.sourceBuildId}</code> · {diagnostic.data.source}</p>
          {diagnostic.data.models.map(item => <p key={item.phase}>
            {item.phase === 'inspection' ? L('Inspection / verification', '시드 검사·최종 검증') : L('Image generation', '이미지 재생성')}
            {' · '}<code>{item.model}</code>{' · '}{item.httpStatus === null ? 'HTTP —' : `HTTP ${item.httpStatus}`}
            {' · '}{item.result === 'available' ? L('Metadata accessible only', '모델 정보 접근 확인') : item.result}
          </p>)}
          <p className="text-muted-foreground">{L('Checked', '확인 시각')}: {diagnostic.data.checkedAt}</p>
        </div>}
      </div>
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
