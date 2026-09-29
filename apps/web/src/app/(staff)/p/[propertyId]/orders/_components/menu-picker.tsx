'use client';

import type { Menu, MenuItem, Outlet } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  LoadingRegion,
  NativeSelect,
  Skeleton,
} from '@hotel/ui';
import { Plus, ReceiptText } from 'lucide-react';
import { t } from '@/lib/i18n';

/** The outlet's menu: pick an outlet, then tap items to add them to the order. */
export function MenuPicker({
  outlets,
  outlet,
  onOutletChange,
  menu,
  loading,
  currency,
  onAdd,
}: {
  outlets: Outlet[] | undefined;
  outlet: string;
  onOutletChange: (outletId: string) => void;
  menu: Menu | undefined;
  loading: boolean;
  currency: string;
  onAdd: (item: MenuItem) => void;
}) {
  return (
    <Card className="animate-fade-in">
      <CardHeader className="gap-3 pb-4">
        <CardTitle className="text-base">{t('fnb.menu')}</CardTitle>
        <NativeSelect
          aria-label={t('fnb.outlet')}
          value={outlet}
          onChange={(e) => onOutletChange(e.target.value)}
        >
          {outlets
            ?.filter((o) => o.active)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </NativeSelect>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {loading && (
          <LoadingRegion label={t('loading')} className="flex flex-col gap-4">
            {Array.from({ length: 2 }, (_, c) => (
              <div key={c} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <div className="grid gap-2 sm:grid-cols-2">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              </div>
            ))}
          </LoadingRegion>
        )}
        {outlets?.length === 0 && (
          <EmptyState icon={<ReceiptText />} title={t('fnb.noOutlets')} className="border-0" />
        )}
        {menu?.categories.map((c) => (
          <div key={c.id} className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {c.name}
            </div>
            <div className="stagger grid gap-2 sm:grid-cols-2">
              {c.items
                .filter((i) => !i.archived)
                .map((i) => (
                  <Button
                    key={i.id}
                    type="button"
                    variant="outline"
                    disabled={!i.available}
                    onClick={() => onAdd(i)}
                    className="group h-auto justify-between whitespace-normal px-3 py-2.5 text-left font-normal text-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground active:scale-[0.98]"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">{i.name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {i.available ? formatMoney(i.priceMinor, currency) : t('fnb.soldOutBadge')}
                      </span>
                    </span>
                    <Plus className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
                  </Button>
                ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
