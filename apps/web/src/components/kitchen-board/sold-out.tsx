'use client';

import { Card, CardContent, FilterChip, Skeleton } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@/lib/i18n';
import type { Pms } from './board-config';

export function SoldOut({
  propertyId,
  pms,
  outletId,
}: {
  propertyId: string;
  pms: Pms;
  outletId: string;
}) {
  const queryClient = useQueryClient();
  const menu = useQuery({
    queryKey: ['menu', propertyId, outletId],
    queryFn: () => pms.menu(outletId),
  });
  const toggle = useMutation({
    mutationFn: (input: { id: string; available: boolean }) =>
      pms.setItemAvailability(input.id, input.available),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['menu', propertyId, outletId] }),
  });
  return (
    <Card className="animate-fade-in">
      <CardContent className="flex flex-wrap items-center gap-2 pt-5 text-sm">
        <span className="font-medium">{t('fnb.soldOut')}</span>
        {menu.isPending &&
          Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        {menu.data?.categories.flatMap((c) =>
          c.items
            .filter((i) => !i.archived)
            .map((i) => (
              <FilterChip
                key={i.id}
                tone="destructive"
                pressed={!i.available}
                disabled={toggle.isPending}
                onPressedChange={() => toggle.mutate({ id: i.id, available: !i.available })}
                className="data-[state=on]:line-through"
              >
                {i.name}
              </FilterChip>
            )),
        )}
      </CardContent>
    </Card>
  );
}
