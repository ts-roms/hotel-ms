'use client';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { formatMoney, minorToInput, parseMoney } from '@/lib/format';
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
  const priceMinor = parseMoney(item.price, currency);
  const addItem = useMutation({
    mutationFn: () =>
      pms.createMenuItem(outlet, {
        categoryId: item.categoryId || menu.data!.categories[0]!.id,
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
  const error = menu.error ?? addCategory.error ?? addItem.error ?? updateItem.error;

  const onAddItem = (event: FormEvent) => {
    event.preventDefault();
    addItem.mutate();
  };

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('fnb.menus')}</h1>
        <Select
          className="w-auto"
          aria-label={t('fnb.outlet')}
          value={outlet}
          onChange={(e) => setOutletId(e.target.value)}
        >
          {outlets.data?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
      {error && <Alert>{errorMessage(error)}</Alert>}

      <Card>
        <CardContent className="flex flex-col gap-2 pt-4">
          <form onSubmit={onAddItem} className="flex flex-wrap items-center gap-2" noValidate>
            <Select
              className="w-auto"
              aria-label={t('fnb.category')}
              value={item.categoryId}
              onChange={(e) => setItem({ ...item, categoryId: e.target.value })}
            >
              {menu.data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
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
              disabled={
                !item.name.trim() ||
                priceMinor === null ||
                !menu.data?.categories.length ||
                addItem.isPending
              }
            >
              {t('fnb.addItem')}
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-56"
              placeholder={t('fnb.newCategory')}
              aria-label={t('fnb.newCategory')}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!category.trim() || addCategory.isPending}
              onClick={() => addCategory.mutate()}
            >
              {t('fnb.addCategory')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {menu.data?.categories.map((c) => (
        <Card key={c.id}>
          <CardHeader>
            <CardTitle className="text-base">{c.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {c.items.map((i) => (
              <div
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
              >
                <span className={i.archived ? 'text-muted-foreground line-through' : ''}>
                  {i.name}
                  {i.modifierGroups.length > 0 && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {i.modifierGroups.map((g) => g.name).join(', ')}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {!i.available && (
                    <Badge className="text-destructive">{t('fnb.soldOutBadge')}</Badge>
                  )}
                  <PriceEditor
                    value={i.priceMinor}
                    currency={currency}
                    onSave={(priceMinor) => updateItem.mutate({ id: i.id, body: { priceMinor } })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      updateItem.mutate({ id: i.id, body: { available: !i.available } })
                    }
                  >
                    {i.available ? t('fnb.markSoldOut') : t('fnb.markAvailable')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => updateItem.mutate({ id: i.id, body: { archived: !i.archived } })}
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
  );
}

function PriceEditor({
  value,
  currency,
  onSave,
}: {
  value: number;
  currency: string;
  onSave: (minor: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) {
    return (
      <button
        type="button"
        className="tabular-nums underline decoration-dotted"
        onClick={() => setText(minorToInput(value, currency))}
      >
        {formatMoney(value, currency)}
      </button>
    );
  }
  const parsed = parseMoney(text, currency);
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed !== null) onSave(parsed);
        setText(null);
      }}
    >
      <Input
        className="w-24"
        autoFocus
        aria-label={t('fnb.price')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button size="sm" type="submit" disabled={parsed === null}>
        ✓
      </Button>
    </form>
  );
}
