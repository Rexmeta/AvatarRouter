import { UserProfile, useUser } from '@clerk/react';
import { Link, useParams } from 'wouter';
import { PageHead, Panel, Skel } from '@/components/bits';
import { useI18n } from '@/lib/i18n';

export default function Account() {
  const { section = 'profile' } = useParams<{section:string}>();
  const { user, isLoaded } = useUser();
  const { lang, setLang } = useI18n();
  const t = (en: string, ko: string) => lang === 'ko' ? ko : en;
  if (!isLoaded) return <Skel className="h-64"/>;
  if (!user) return <Panel className="p-6"><Link className="arw-button primary" href="/sign-in">{t('Sign in','로그인')}</Link></Panel>;
  return <div><PageHead index="ACCOUNT" title={section === 'preferences' ? t('Preferences','환경설정') : t('Profile & security','프로필·보안')} lede={t('Account-wide settings. Workspace credentials and assets remain separate.','계정 전체에 적용되는 설정입니다. 워크스페이스별 자격 증명·에셋과 구분됩니다.')}/>
    {section === 'preferences' ? <Panel className="p-6"><label className="flex items-center justify-between gap-5 text-sm">{t('Display language','표시 언어')}<select className="rounded border bg-background px-3 py-2" value={lang} onChange={e=>setLang(e.target.value as 'ko'|'en')}><option value="ko">한국어</option><option value="en">English</option></select></label><p className="mt-5 text-xs text-muted-foreground">{t('Language preference is saved on this browser. Account and provider settings are not changed.','언어 선택은 현재 브라우저에 저장됩니다. 계정 권한·제공자 설정은 변경되지 않습니다.')}</p></Panel> : <UserProfile routing="hash" appearance={{elements:{rootBox:'w-full',cardBox:'w-full max-w-full'}}}/>}
  </div>;
}
