import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Playground from '@/pages/playground';
import Providers from '@/pages/providers';
import Sessions from '@/pages/sessions';
import Usage from '@/pages/usage';
import Docs from '@/pages/docs';
import AvatarAssets from '@/pages/avatar-assets';
import { setSelectedAsset } from '@/lib/selected-asset';
import { Shell } from '@/components/shell';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

// REQUIRED — copy verbatim.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev, auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(12 86% 54%)',
    colorForeground: 'hsl(196 38% 13%)',
    colorMutedForeground: 'hsl(196 12% 38%)',
    colorDanger: 'hsl(352 70% 44%)',
    colorBackground: 'hsl(42 40% 98%)',
    colorInput: 'hsl(42 30% 95%)',
    colorInputForeground: 'hsl(196 38% 13%)',
    colorNeutral: 'hsl(196 38% 13%)',
    fontFamily: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
    borderRadius: '0.375rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[hsl(42_40%_98%)] rounded-md border border-[hsl(40_16%_82%)] shadow-[0_14px_30px_-12px_hsl(196_40%_12%/0.25)] w-[420px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[hsl(196_38%_13%)] font-bold tracking-tight',
    headerSubtitle: 'text-[hsl(196_12%_38%)]',
    socialButtonsBlockButtonText: 'text-[hsl(196_38%_13%)] font-medium',
    formFieldLabel: 'text-[hsl(196_38%_13%)] font-medium',
    footerActionLink: 'text-[hsl(12_86%_48%)] font-semibold',
    footerActionText: 'text-[hsl(196_12%_38%)]',
    dividerText: 'text-[hsl(196_12%_42%)]',
    identityPreviewEditButton: 'text-[hsl(12_86%_48%)]',
    formFieldSuccessText: 'text-[hsl(164_55%_30%)]',
    alertText: 'text-[hsl(352_70%_38%)]',
    logoBox: 'h-10',
    logoImage: 'h-10 w-10',
    socialButtonsBlockButton: 'border border-[hsl(40_16%_80%)] bg-[hsl(42_40%_98%)]',
    formButtonPrimary: 'bg-[hsl(12_86%_54%)] text-[hsl(42_40%_98%)] font-semibold shadow-none',
    formFieldInput: 'bg-[hsl(42_30%_95%)] border border-[hsl(40_14%_76%)] text-[hsl(196_38%_13%)]',
    footerAction: 'bg-[hsl(40_22%_92%)] py-3',
    dividerLine: 'bg-[hsl(40_16%_80%)]',
    alert: 'bg-[hsl(352_70%_44%/0.06)] border border-[hsl(352_70%_44%/0.3)]',
    otpCodeFieldInput: 'border border-[hsl(40_14%_76%)] text-[hsl(196_38%_13%)]',
    formFieldRow: 'gap-3',
    main: 'gap-5',
  },
};

function AuthFrame({ children }: { children: ReactNode }) {
  const { lang } = useI18n();
  return (
    <div className="grid min-h-[100dvh] bg-background md:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground md:flex">
        <Link href="/" className="flex items-center gap-2.5" data-testid="link-auth-home">
          <img src={`${basePath}/logo.svg`} alt="" className="h-8 w-8" />
          <div className="leading-tight">
            <div className="text-[15px] font-bold">AvatarRouter</div>
            <div className="mono text-[10px] uppercase tracking-widest opacity-50">Studio</div>
          </div>
        </Link>
        <div className="max-w-sm">
          <div className="mono mb-4 text-[10px] uppercase tracking-widest text-sidebar-primary">{lang === 'en' ? 'Private asset vault' : '비공개 에셋 보관소'}</div>
          <p className="text-3xl font-bold leading-tight tracking-tight">
            {lang === 'en' ? 'Your source images stay yours. Only you see what you upload.' : '원본 이미지는 당신의 것입니다. 업로드한 내용은 본인만 볼 수 있습니다.'}
          </p>
          <ul className="mono mt-8 space-y-2 text-[11.5px] opacity-70">
            <li>— {lang === 'en' ? 'rights confirmation on every ingest' : '모든 업로드에 권리 확인'}</li>
            <li>— {lang === 'en' ? 'real-person likeness held for operator review' : '실존 인물 초상은 운영자 검토 대기'}</li>
            <li>— {lang === 'en' ? 'provider training cost confirmed explicitly' : '프로바이더 학습 비용 명시적 확인'}</li>
          </ul>
        </div>
        <svg viewBox="0 0 400 400" className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 opacity-20">
          {[60, 100, 140, 180].map((r) => <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="currentColor" />)}
          <circle cx="200" cy="200" r="28" fill="hsl(var(--sidebar-primary))" />
        </svg>
      </aside>
      <div className="flex items-center justify-center px-4 py-10">{children}</div>
    </div>
  );
}

function SignInPage() {
  return (
    <AuthFrame>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthFrame>
  );
}

function SignUpPage() {
  return (
    <AuthFrame>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/avatar-assets" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
        setSelectedAsset(null);
      }
      if (prevUserIdRef.current === undefined && userId === null) setSelectedAsset(null);
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ShellRoutes() {
  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/avatar-assets" component={AvatarAssets} />
          <Route path="/avatar-assets/:id" component={AvatarAssets} />
          <Route path="/playground" component={Playground} />
          <Route path="/providers" component={Providers} />
          <Route path="/sessions" component={Sessions} />
          <Route path="/usage" component={Usage} />
          <Route path="/docs" component={Docs} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  const { lang } = useI18n();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: lang === 'en' ? 'Sign in to AvatarRouter' : 'AvatarRouter 로그인',
            subtitle: lang === 'en' ? 'Your private image and avatar assets are waiting.' : '비공개 이미지와 아바타 에셋을 확인하세요.',
          },
        },
        signUp: {
          start: {
            title: lang === 'en' ? 'Create a Studio account' : 'Studio 계정 만들기',
            subtitle: lang === 'en' ? 'Required to upload images and provision avatars.' : '이미지 업로드와 아바타 프로비저닝에 필요합니다.',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={ShellRoutes} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <I18nProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </I18nProvider>
  );
}

export default App;
