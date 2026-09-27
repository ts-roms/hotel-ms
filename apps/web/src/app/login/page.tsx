'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@hotel/api-client';
import { type LoginRequest, loginRequestSchema } from '@hotel/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@hotel/ui';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { t } from '@/lib/i18n';
import { useLogin } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const info = await login.mutateAsync(values).catch(() => null);
    if (!info) return;
    router.replace(info.activeOrganizationId ? '/dashboard' : '/select-organization');
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
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('login.title')}</CardTitle>
          <CardDescription>{t('login.subtitle')}</CardDescription>
        </CardHeader>
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
            <Button type="submit" disabled={login.isPending}>
              {login.isPending ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
