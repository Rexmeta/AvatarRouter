import { Link } from 'wouter';
import { LogIn, LogOut } from 'lucide-react';
import { useClerk, useUser } from '@clerk/react';
import { useI18n } from '@/lib/i18n';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function AuthControl() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const { lang } = useI18n();
  if (!isLoaded) return <span className="h-6 w-14 animate-pulse rounded bg-sidebar-accent" />;
  if (!user) {
    return (
      <Link href="/sign-in" data-testid="link-sign-in" className="mono inline-flex items-center gap-1 rounded border border-sidebar-border px-2 py-0.5 text-[11px] opacity-80 hover:opacity-100">
        <LogIn className="h-3 w-3" /> {lang === 'en' ? 'Sign in' : '로그인'}
      </Link>
    );
  }
  const initial = (user.firstName ?? user.primaryEmailAddress?.emailAddress ?? '?').slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-1.5">
      <span title={user.primaryEmailAddress?.emailAddress ?? ''} data-testid="text-user-initial" className="mono grid h-6 w-6 place-items-center rounded-full bg-sidebar-primary text-[11px] font-semibold text-sidebar-primary-foreground">{initial}</span>
      <button
        type="button"
        data-testid="button-sign-out"
        onClick={() => signOut({ redirectUrl: basePath || '/' })}
        className="rounded p-1 opacity-60 transition hover:bg-sidebar-accent hover:opacity-100"
        aria-label="Sign out"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
