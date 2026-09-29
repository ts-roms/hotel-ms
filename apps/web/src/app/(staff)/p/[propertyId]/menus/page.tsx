'use client';

import { parseMoney } from '@hotel/format';
import {
  Alert,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  LoadingRegion,
  PageHeader,
  NativeSelect,
  SkeletonCard,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, FolderPlus, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';
import { MenuCategoryCard } from './_components/menu-category-card';

/** Outlet menus: categories, items, prices and availability (blueprint §14). */
export default function MenusPage() {
  const propertyId = usePropertyId();
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
          <MenuCategoryCard
            key={c.id}
            category={c}
            propertyId={propertyId}
            currency={currency}
            updating={updating}
            updatePending={updateItem.isPending}
            onUpdate={(id, body) => updateItem.mutate({ id, body })}
            onPhotoChanged={() => queryClient.invalidateQueries({ queryKey: key })}
          />
        ))}
      </div>
    </div>
  );
}
