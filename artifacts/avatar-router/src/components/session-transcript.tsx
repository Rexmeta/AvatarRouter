import { useAuth } from '@clerk/react';
import { useGetTavusFinalTranscript } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { errMsg } from './bits';

/** Same authenticated end-of-call reader for every native provider. */
export function SessionTranscript({ id }: { id: string }) {
  const { userId, isSignedIn } = useAuth();
  const { lang } = useI18n();
  const ko = lang !== 'en';
  const q = useGetTavusFinalTranscript(id, {
    query: {
      queryKey: ['session-transcript', id, userId],
      enabled: !!id && isSignedIn,
      staleTime: 0,
      refetchInterval: (query) => query.state.data?.status === 'pending' ? 5000 : false,
      retry: false,
    },
  });
  if (!isSignedIn) return null;
  return <section className="space-y-2 border-t p-4" data-testid="session-transcript">
    <h3 className="text-sm font-semibold">{ko ? '대화 기록 · 제공자 최종 기록' : 'Dialogue · provider final transcript'}</h3>
    {q.isError ? <div role="alert" className="text-sm text-destructive">
      <p>{errMsg(q.error)}</p>
      <button className="underline" onClick={() => void q.refetch()}>{ko ? '기록 다시 조회' : 'Read transcript again'}</button>
    </div> : q.data?.status === 'ready' ? q.data.messages?.length ? <ol className="max-h-72 space-y-2 overflow-auto">
      {q.data.messages.map((m, i) => <li key={`${m.timestamp}-${i}`} className="text-sm">
        <span className="font-semibold">{m.role === 'user' ? (ko ? '사용자' : 'User') : (ko ? '아바타' : 'Avatar')}: </span>
        <span className="whitespace-pre-wrap">{m.text}</span>
      </li>)}
    </ol> : <p className="text-sm text-muted-foreground">{ko ? '제공자 기록에 발화가 없습니다.' : 'No utterances in the provider transcript.'}</p>
      : <p className="text-sm text-muted-foreground">{q.data?.status === 'unavailable'
        ? <>{ko ? '기록을 사용할 수 없습니다. 제공자의 보관 설정 또는 기록 만료 여부를 확인하세요.' : 'Transcript unavailable. Check provider retention settings or expiry.'}
          <button className="ml-2 underline" onClick={() => void q.refetch()}>{ko ? '기록 다시 조회' : 'Read again'}</button></>
        : (ko ? '세션 종료 및 제공자 기록 확정을 기다립니다.' : 'Waiting for session end and provider transcript.')}</p>}
  </section>;
}
