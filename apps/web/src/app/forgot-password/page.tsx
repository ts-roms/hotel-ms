'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type ForgotPasswordRequest, forgotPasswordRequestSchema } from '@hotel/contracts';
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
  Notice,
} from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

export default function ForgotPasswordPage() {
  const request = useMutation({ mutationFn: (email: string) => api.auth.forgotPassword(email) });
  const form = useForm<ForgotPasswordRequest>({
    resolver: zodResolver(forgotPasswordRequestSchema),
    defaultValues: { email: '' },
  });

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('forgot.title')}</CardTitle>
          <CardDescription>{t('forgot.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {request.isSuccess ? (
            <Notice>{t('forgot.sent')}</Notice>
          ) : (
            <form
              onSubmit={form.handleSubmit((v) => request.mutate(v.email))}
              className="flex flex-col gap-4"
              noValidate
            >
              {request.error && <Alert>{errorMessage(request.error)}</Alert>}
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">{t('login.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  {...form.register('email')}
                />
              </div>
              <Button type="submit" disabled={request.isPending}>
                {t('forgot.submit')}
              </Button>
            </form>
          )}
          <Link href="/login" className="text-center text-sm text-muted-foreground underline">
            {t('login.title')}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
