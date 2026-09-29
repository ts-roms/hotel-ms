'use client';

import { SERVICE_CATEGORIES, type ServiceRequest } from '@hotel/contracts';
import {
  Alert,
  Badge,
  type BadgeVariant,
  Button,
  CardContent,
  Input,
  Label,
  LoadingRegion,
  NativeSelect,
  Skeleton,
  StarRating,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Send, Star } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Section } from '@/components/section';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';

const categoryLabel = (category: (typeof SERVICE_CATEGORIES)[number]) =>
  t(`requests.category.${category}`);

/** What the request form offers; checkout has its own card. */
const REQUEST_CATEGORIES = SERVICE_CATEGORIES.filter(
  (c): c is Exclude<(typeof SERVICE_CATEGORIES)[number], 'CHECKOUT'> => c !== 'CHECKOUT',
);

const STATUS_VARIANTS: Record<ServiceRequest['status'], BadgeVariant> = {
  OPEN: 'info',
  ACKNOWLEDGED: 'primary',
  IN_PROGRESS: 'warning',
  DONE: 'success',
  CANCELLED: 'danger',
};

export function ServiceRequests() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<(typeof REQUEST_CATEGORIES)[number]>('TOWELS');
  const [description, setDescription] = useState('');
  const list = useQuery({ queryKey: ['requests'], queryFn: api.serviceRequests });
  const create = useMutation({
    mutationFn: () => api.createServiceRequest({ category, description: description.trim() }),
    onSuccess: () => {
      setDescription('');
      return queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });
  const rate = useMutation({
    mutationFn: (input: { id: string; rating: number }) => api.rate(input.id, input.rating),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['requests'] }),
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Section icon={<BellRing />} title={t('requests.title')}>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          {create.error && <Alert>{errorMessage(create.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="category">{t('requests.request')}</Label>
            <NativeSelect
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
            >
              {REQUEST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="details">{t('requests.details')}</Label>
            <Input
              id="details"
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" loading={create.isPending}>
            {!create.isPending && <Send />}
            {t('requests.send')}
          </Button>
        </form>
        {rate.error && <Alert>{errorMessage(rate.error)}</Alert>}
        {list.isPending && (
          <LoadingRegion label={t('requests.loading')} className="flex flex-col gap-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </LoadingRegion>
        )}
        <ul className="stagger flex flex-col gap-2">
          {list.data?.map((r) => {
            return (
              <li key={r.id} className="flex flex-col gap-1 rounded-xl border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{categoryLabel(r.category)}</span>
                  <Badge variant={STATUS_VARIANTS[r.status]} dot>
                    {t(`requests.status.${r.status}`)}
                  </Badge>
                </div>
                {r.description && <p className="text-muted-foreground">{r.description}</p>}
                {r.status === 'DONE' &&
                  (r.rating ? (
                    <p className="mt-1 flex items-center gap-1 text-muted-foreground">
                      <Star className="size-3.5 fill-warning text-warning" />
                      {t('requests.rated', { rating: r.rating })}
                    </p>
                  ) : (
                    <StarRating
                      prompt={t('requests.howDidWeDo')}
                      label={t('requests.rate')}
                      starLabel={(count) => t('requests.stars', { count })}
                      disabled={rate.isPending}
                      onRate={(rating) => rate.mutate({ id: r.id, rating })}
                    />
                  ))}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Section>
  );
}
