'use client';

import { formatMoney, minorToInput, parseMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Input,
  LoadingRegion,
  PageHeader,
  NativeSelect,
  SkeletonCard,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, FolderPlus, Pencil, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';

/** Outlet menus: categories, items, prices and availability (blueprint §14). */
export default function MenusPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const outlets = useQuery({ queryKey: ['outlets', propertyId], queryFn: pms.outlets });
  const [outletId, setOutletId] = useState('');
  const outlet = outletId || outlets.data?.[0]?.id || '';
  const key = ['menu', propertyId, outlet];
  const menu = useQuery({ queryKey: key, queryFn: () => pms.menu(outlet), enabled: !!outlet });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const currency = menu.data?.currency ?? 'PHP';

  const [category, setCategory] = useState('');
  const addCategory = useMutation({
    mutationFn: () => pms.createCategory(outlet, category),
    onSuccess: () => {
      setCategory('');
      return refresh();
    },
  });
  const [item, setItem] = useState({ categoryId: '', name: '', price: '' });
  // '' means "not chosen yet": show and submit the first category. Categories load after
  // the first render, so the select must be given that option explicitly or it shows blank.
  const categoryId = item.categoryId || menu.data?.categories[0]?.id || '';
  const priceMinor = parseMoney(item.price, currency);
  const addItem = useMutation({
    mutationFn: () =>
      pms.createMenuItem(outlet, {
        categoryId,
        name: item.name,
        description: '',
        priceMinor: priceMinor!,
        modifierGroups: [],
      }),
    onSuccess: () => {
      setItem({ ...item, name: '', price: '' });
      return refresh();
    },
  });
  const updateItem = useMutation({
    mutationFn: (input: { id: string; body: Parameters<typeof pms.updateMenuItem>[1] }) =>
      pms.updateMenuItem(input.id, input.body),
    onSettled: refresh,
  });
  /** Only the button that started the change shows a spinner. */
  const updating = (id: string, field: 'available' | 'archived' | 'priceMinor') =>
    updateItem.isPending && updateItem.variables?.id === id && field in updateItem.variables.body;
  const error = menu.error ?? addCategory.error ?? addItem.error ?? updateItem.error;

  const onAddItem = (event: FormEvent) => {
    event.preventDefault();
    addItem.mutate();
  };
  const loading = outlets.isPending || (!!outlet && menu.isPending);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={t('fnb.menus')}
        actions={
          <NativeSelect
            className="h-9 w-auto"
            aria-label={t('fnb.outlet')}
            value={outlet}
            onChange={(e) => setOutletId(e.target.value)}
          >
            {outlets.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        }
      />
      {error && <Alert>{errorMessage(error)}</Alert>}
      {outlets.data?.length === 0 && <EmptyState icon={<BookOpen />} title={t('fnb.noOutlets')} />}

      {outlet && (
        <Card className="animate-fade-in">
          <CardContent className="flex flex-col gap-3 pt-5">
            <form onSubmit={onAddItem} className="flex flex-wrap items-center gap-2" noValidate>
              <NativeSelect
                className="w-auto"
                aria-label={t('fnb.category')}
                value={categoryId}
                onChange={(e) => setItem({ ...item, categoryId: e.target.value })}
              >
                {menu.data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              <Input
                className="min-w-40 flex-1"
                placeholder={t('fnb.itemName')}
                aria-label={t('fnb.itemName')}
                value={item.name}
                onChange={(e) => setItem({ ...item, name: e.target.value })}
              />
              <Input
                className="w-28"
                placeholder={t('fnb.price')}
                aria-label={t('fnb.price')}
                inputMode="decimal"
                value={item.price}
                onChange={(e) => setItem({ ...item, price: e.target.value })}
              />
              <Button
                type="submit"
                loading={addItem.isPending}
                disabled={!item.name.trim() || priceMinor === null || !categoryId}
              >
                {!addItem.isPending && <Plus />}
                {t('fnb.addItem')}
              </Button>
            </form>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Input
                className="w-56"
                placeholder={t('fnb.newCategory')}
                aria-label={t('fnb.newCategory')}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <Button
                variant="outline"
                loading={addCategory.isPending}
                disabled={!category.trim()}
                onClick={() => addCategory.mutate()}
              >
                {!addCategory.isPending && <FolderPlus />}
                {t('fnb.addCategory')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && (
        <LoadingRegion label={t('loading')} className="flex flex-col gap-4">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={3} />
        </LoadingRegion>
      )}
      {menu.data?.categories.length === 0 && (
        <EmptyState icon={<BookOpen />} title={t('fnb.noMenuItems')} />
      )}

      <div className="stagger flex flex-col gap-4">
        {menu.data?.categories.map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {c.name}
                <Badge className="tabular-nums">{c.items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col text-sm">
              {c.items.map((i) => (
                <div
                  key={i.id}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 border-t py-2.5 transition-colors',
                    i.archived && 'opacity-60',
                  )}
                >
                  <span
                    className={i.archived ? 'text-muted-foreground line-through' : 'font-medium'}
                  >
                    {i.name}
                    {i.modifierGroups.length > 0 && (
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        · {i.modifierGroups.map((g) => g.name).join(', ')}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    {!i.available && <Badge variant="danger">{t('fnb.soldOutBadge')}</Badge>}
                    <PriceEditor
                      value={i.priceMinor}
                      currency={currency}
                      saving={updating(i.id, 'priceMinor')}
                      onSave={(priceMinor) => updateItem.mutate({ id: i.id, body: { priceMinor } })}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={updating(i.id, 'available')}
                      disabled={updateItem.isPending}
                      onClick={() =>
                        updateItem.mutate({ id: i.id, body: { available: !i.available } })
                      }
                    >
                      {i.available ? t('fnb.markSoldOut') : t('fnb.markAvailable')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={updating(i.id, 'archived')}
                      disabled={updateItem.isPending}
                      onClick={() =>
                        updateItem.mutate({ id: i.id, body: { archived: !i.archived } })
                      }
                    >
                      {i.archived ? t('fnb.restore') : t('fnb.archive')}
                    </Button>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PriceEditor({
  value,
  currency,
  saving,
  onSave,
}: {
  value: number;
  currency: string;
  saving: boolean;
  onSave: (minor: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) {
    return (
      <Button
        type="button"
        variant="ghost"
        disabled={saving}
        className="group h-auto gap-1 rounded-md px-2 py-1 text-foreground tabular-nums disabled:opacity-60 [&_svg]:size-3"
        onClick={() => setText(minorToInput(value, currency))}
      >
        {formatMoney(value, currency)}
        <Pencil className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </Button>
    );
  }
  const parsed = parseMoney(text, currency);
  return (
    <form
      className="flex animate-fade-in items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed !== null) onSave(parsed);
        setText(null);
      }}
    >
      <Input
        className="h-8 w-24"
        autoFocus
        aria-label={t('fnb.price')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        size="icon"
        className="size-8"
        type="submit"
        aria-label={t('fnb.price')}
        disabled={parsed === null}
      >
        <Check />
      </Button>
    </form>
  );
}
