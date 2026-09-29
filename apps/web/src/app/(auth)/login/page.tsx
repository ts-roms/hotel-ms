'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@hotel/api-client';
import { type LoginRequest, loginRequestSchema } from '@hotel/contracts';
import { Alert, Button, CardContent, Input, Label } from '@hotel/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { AuthCard } from '@/components/auth-shell';
import { t } from '@/lib/i18n';
import { nextRoute, useLogin } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const info = await login.mutateAsync(values).catch(() => null);
    if (info) router.replace(nextRoute(info));
  });

  const error = login.error;
  const errorMessage =
    error instanceof ApiError
      ? error.code === 'RATE_LIMITED'
        ? t('login.rateLimited')
        : error.code === 'INVALID_CREDENTIALS'
          ? t('login.invalid')
          : t('error.generic')
      : error
        ? t('error.generic')
        : null;

  return (
    <AuthCard title={t('login.title')} description={t('login.subtitle')}>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {errorMessage && <Alert>{errorMessage}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t('login.email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              aria-invalid={!!form.formState.errors.email}
              {...form.register('email')}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t('login.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!form.formState.errors.password}
              {...form.register('password')}
            />
          </div>
          <Button type="submit" size="lg" loading={login.isPending}>
            {login.isPending ? t('login.submitting') : t('login.submit')}
          </Button>
          <Link
            href="/forgot-password"
            className="text-center text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
          >
            {t('login.forgot')}
          </Link>
        </form>
      </CardContent>
    </AuthCard>
  );
}
