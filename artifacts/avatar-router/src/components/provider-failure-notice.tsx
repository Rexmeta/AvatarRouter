import type { Session } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';

const explanations = {
  authentication: 'Tavus가 제공자 인증을 거부했습니다. 라우터 운영자가 Tavus API 키를 확인해야 합니다.',
  billing: 'Tavus가 결제·크레딧 제한을 알렸습니다. 라우터 운영자가 제공자 잔액과 결제 상태를 확인해야 합니다.',
  concurrency_limit: 'Tavus 동시 대화 한도에 도달했습니다. 기존 대화를 확인해야 하며 자동 재시도하지 않습니다.',
  provider_limit: 'Tavus 사용량·요청 한도에 걸렸습니다. 이것만으로 비용 부족을 확정할 수는 없습니다.',
  permission_or_plan: 'Tavus가 접근을 거부했습니다. 계정 권한·플랜 제한을 확인해야 하며 비용 부족은 확정되지 않았습니다.',
  configuration: 'Tavus가 요청이나 리소스 조회를 거부했습니다. PAL·아바타·요청값을 확인하되, 구체적인 제공자 코드 없이는 계정·플랜 제한도 배제할 수 없습니다.',
  provider_unavailable: 'Tavus 시간 초과 또는 서버 오류입니다. 생성 결과가 불확실할 수 있어 정리 상태를 먼저 확인해야 합니다.',
  unknown: '생성은 실패했지만 원래 거절 정보가 보존되지 않아 비용·권한·설정 중 어느 원인인지 확정할 수 없습니다.',
};

export function ProviderFailureNotice({ failure }: { failure?: Session['failure'] }) {
  const { lang } = useI18n();
  const t = (en: string, ko: string) => lang === 'en' ? en : ko;
  if (!failure) return null;
  return <div role="alert" data-testid="provider-failure-notice" className="my-3 rounded border border-destructive/30 bg-destructive/5 p-3 text-sm">
    <p className="font-medium">{t('Provider creation failed', '외부 아바타 생성 실패')}</p>
    <p className="mt-1">{t(failure.message, explanations[failure.category])}</p>
    <p className="mono mt-2 text-xs text-muted-foreground">
      {failure.code} · {failure.stage} · HTTP {failure.providerHttpStatus ?? t('not retained', '보존 안 됨')}
      {failure.providerErrorCode ? ` · ${failure.providerErrorCode}` : ''}
    </p>
    <p className="mt-1 text-xs">{t('Cleanup completion does not mean a successful conversation. No automatic paid retry.', '정리 완료는 대화 성공을 뜻하지 않습니다. 유료 생성은 자동 재시도하지 않습니다.')}</p>
  </div>;
}
