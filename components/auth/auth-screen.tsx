'use client';

import { ArrowLeft, ArrowRight, CheckCircle2, Mail, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import { AlostadLogo } from '@/components/brand/alostad-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/hooks/use-i18n';

import { useAuth } from './auth-provider';

type AuthStep = 'email' | 'code';

const OTP_LENGTH = 6;

export function AuthScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { configured, loading: authLoading, supabase, user } = useAuth();
  const [step, setStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user) router.replace('/');
  }, [authLoading, router, user]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  const emailErrorId = 'auth-email-error';
  const codeErrorId = 'auth-code-error';
  const isCodeValid = useMemo(() => /^\d{6}$/.test(code), [code]);

  const sendCode = async (event?: FormEvent) => {
    event?.preventDefault();
    setError(null);
    setNotice(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setError(t('auth.invalidEmail'));
      return;
    }
    if (!supabase) {
      setError(t('auth.notConfigured'));
      return;
    }

    setBusy(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }

    setEmail(normalizedEmail);
    setStep('code');
    setCode('');
    setResendIn(30);
    setNotice(t('auth.codeSent'));
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!isCodeValid) {
      setError(t('auth.invalidCode'));
      return;
    }
    if (!supabase) {
      setError(t('auth.notConfigured'));
      return;
    }

    setBusy(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    setBusy(false);
    if (verifyError) {
      setError(t('auth.invalidCode'));
      return;
    }

    router.replace('/');
  };

  const reset = () => {
    setStep('email');
    setCode('');
    setError(null);
    setNotice(null);
  };

  if (!configured) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <AlostadLogo size="gate" />
            <CardTitle className="mt-4">{t('auth.notConfiguredTitle')}</CardTitle>
            <CardDescription>{t('auth.notConfigured')}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#f7f8ff] px-4 py-4 text-foreground dark:bg-[#080b18] sm:px-6 lg:px-10 lg:py-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -start-20 -top-20 size-80 rounded-full bg-[#2f3b96]/15 blur-3xl dark:bg-[#7d87e6]/15" />
        <div className="absolute -bottom-24 -end-16 size-96 rounded-full bg-[#f4796b]/14 blur-3xl dark:bg-[#f79384]/14" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between">
        <AlostadLogo size="md" />
        <LanguageSwitcher />
      </header>

      <div className="relative z-10 mx-auto grid min-h-[calc(100dvh-6rem)] w-full max-w-6xl items-center gap-8 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <section className="hidden lg:block">
          <div className="max-w-xl">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/6 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <span className="size-1.5 rounded-full bg-[#f4796b]" aria-hidden="true" />
              Alostad classroom
            </p>
            <h1 className="text-5xl font-semibold leading-[1.08] tracking-[-0.04em] text-balance xl:text-6xl">
              {t('auth.heroTitle')}
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-muted-foreground">
              {t('auth.heroDescription')}
            </p>
          </div>

          <div className="mt-12 grid max-w-xl gap-3 sm:grid-cols-3">
            {[
              { icon: Mail, text: t('auth.featureEmail') },
              { icon: ShieldCheck, text: t('auth.featureSecure') },
              { icon: CheckCircle2, text: t('auth.featureReady') },
            ].map(({ icon: Icon, text }) => (
              <div
                key={text}
                className="rounded-2xl border border-border/70 bg-background/75 p-4 backdrop-blur"
              >
                <Icon className="size-5 text-primary" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium leading-6">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <Card className="mx-auto w-full max-w-md border-border/70 bg-background/90 shadow-2xl shadow-primary/8 backdrop-blur">
          <CardHeader className="space-y-3 px-5 pb-2 sm:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                {step === 'email' ? (
                  <Mail className="size-5" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-5" aria-hidden="true" />
                )}
              </div>
              <div>
                <CardTitle>{step === 'email' ? t('auth.title') : t('auth.codeTitle')}</CardTitle>
                <CardDescription>
                  {step === 'email' ? t('auth.description') : t('auth.codeDescription', { email })}
                </CardDescription>
              </div>
            </div>
            <div className="hidden lg:block">
              <CardTitle>{step === 'email' ? t('auth.title') : t('auth.codeTitle')}</CardTitle>
              <CardDescription className="mt-1">
                {step === 'email' ? t('auth.description') : t('auth.codeDescription', { email })}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="px-5 pb-6 pt-5 sm:px-8 sm:pb-8">
            {step === 'email' ? (
              <form className="space-y-5" onSubmit={sendCode} noValidate>
                <div className="space-y-2">
                  <Label htmlFor="auth-email">{t('auth.emailLabel')}</Label>
                  <Input
                    id="auth-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t('auth.emailPlaceholder')}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? emailErrorId : undefined}
                    disabled={busy}
                    className="h-11 rounded-xl px-3.5"
                  />
                  {error && (
                    <p id={emailErrorId} className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  )}
                </div>
                {notice && (
                  <p
                    className="rounded-xl bg-primary/8 px-3 py-2 text-sm leading-6 text-primary"
                    role="status"
                  >
                    {notice}
                  </p>
                )}
                <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl">
                  {busy ? t('auth.sending') : t('auth.sendCode')}
                  {!busy && <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />}
                </Button>
                <p className="text-center text-xs leading-5 text-muted-foreground">
                  {t('auth.privacyHint')}
                </p>
              </form>
            ) : (
              <form className="space-y-5" onSubmit={verifyCode} noValidate>
                <div className="rounded-xl border border-primary/15 bg-primary/6 px-3 py-3 text-sm leading-6 text-muted-foreground">
                  {t('auth.codeDescription', { email })}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auth-code">{t('auth.codeLabel')}</Label>
                  <Input
                    id="auth-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={OTP_LENGTH}
                    pattern="[0-9]{6}"
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))
                    }
                    placeholder="000000"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? codeErrorId : undefined}
                    disabled={busy}
                    className="h-14 rounded-xl text-center text-2xl font-semibold tracking-[0.45em]"
                  />
                  {error && (
                    <p id={codeErrorId} className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  )}
                </div>
                {notice && (
                  <p
                    className="rounded-xl bg-primary/8 px-3 py-2 text-sm leading-6 text-primary"
                    role="status"
                  >
                    {notice}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={busy || !isCodeValid}
                  className="h-11 w-full rounded-xl"
                >
                  {busy ? t('auth.verifying') : t('auth.verifyCode')}
                  {!busy && <CheckCircle2 className="size-4" aria-hidden="true" />}
                </Button>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                    {t('auth.changeEmail')}
                  </button>
                  <button
                    type="button"
                    disabled={busy || resendIn > 0}
                    onClick={() => void sendCode()}
                    className="text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {resendIn > 0
                      ? t('auth.resendIn', { seconds: resendIn })
                      : t('auth.resendCode')}
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
