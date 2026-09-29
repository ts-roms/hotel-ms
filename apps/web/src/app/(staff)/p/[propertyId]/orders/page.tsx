'use client';

import {
  type CartLine,
  cartCount,
  cartTotal,
  linePrice,
  type MenuItem,
  newCartLine,
  type Order,
  type OrderItemInput,
  type StaffOrderRequest,
  toggleModifier,
} from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  LoadingRegion,
  ModifierPicker,
  NativeSelect,
  PageHeader,
  SectionCard,
  Skeleton,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ReceiptText, ShoppingBag, X } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms, usePropertyId } from '@/lib/property';
import { statusLabel, statusVariant } from '@/lib/status';

/** Order taking for outlets and phone room service (blueprint §14). */
export default function OrdersPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
  const queryClient = useQueryClient();
  const outlets = useQuery({ queryKey: ['outlets', propertyId], queryFn: pms.outlets });
  const rooms = useQuery({ queryKey: ['rooms', propertyId], queryFn: pms.rooms });
  const [outletId, setOutletId] = useState('');
  const outlet = outletId || outlets.data?.find((o) => o.active)?.id || '';
  const menu = useQuery({
    queryKey: ['menu', propertyId, outlet],
    queryFn: () => pms.menu(outlet),
    enabled: !!outlet,
  });
  const recent = useQuery({
    queryKey: ['orders', propertyId],
    queryFn: () => pms.orders({ status: 'ACTIVE' }),
    refetchInterval: 15_000,
  });

  const [cart, setCart] = useState<CartLine[]>([]);
  const [chargeMethod, setChargeMethod] =
    useState<StaffOrderRequest['chargeMethod']>('ROOM_CHARGE');
  const [roomId, setRoomId] = useState('');
  const [notes, setNotes] = useState('');
  // One key per attempt: a retry after a network error reuses it, a new order gets a new one.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  const place = useMutation({
    mutationFn: () =>
      pms.placeOrder(
        {
          outletId: outlet,
          chargeMethod,
          roomId: roomId || null,
          notes,
          items: cart.map<OrderItemInput>((l) => ({
            menuItemId: l.item.id,
            quantity: l.quantity,
            modifierIds: l.modifierIds,
            notes: '',
          })),
        },
        attemptKey,
      ),
    onSuccess: () => {
      setCart([]);
      setNotes('');
      setAttemptKey(crypto.randomUUID());
      return queryClient.invalidateQueries({ queryKey: ['orders', propertyId] });
    },
  });
  const cancel = useMutation({
    mutationFn: (o: Order) => pms.cancelOrder(o.id, o.version, t('fnb.cancelledByStaff')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orders', propertyId] }),
  });

  const currency = menu.data?.currency ?? 'PHP';
  const total = cartTotal(cart);
  // New lines start with the first option of each required group.
  const add = (item: MenuItem) => setCart([...cart, newCartLine(item)]);
  const update = (index: number, change: Partial<CartLine>) =>
    setCart(cart.map((l, i) => (i === index ? { ...l, ...change } : l)));
  const menuLoading = outlets.isPending || (!!outlet && menu.isPending);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('fnb.orders')} />
      {can('fnb.order.create') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="animate-fade-in">
            <CardHeader className="gap-3 pb-4">
              <CardTitle className="text-base">{t('fnb.menu')}</CardTitle>
              <NativeSelect
                aria-label={t('fnb.outlet')}
                value={outlet}
                onChange={(e) => {
                  setOutletId(e.target.value);
                  setCart([]);
                }}
              >
                {outlets.data
                  ?.filter((o) => o.active)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </NativeSelect>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              {menuLoading && (
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
              {outlets.data?.length === 0 && (
                <EmptyState
                  icon={<ReceiptText />}
                  title={t('fnb.noOutlets')}
                  className="border-0"
                />
              )}
              {menu.data?.categories.map((c) => (
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
                          onClick={() => add(i)}
                          className="group h-auto justify-between whitespace-normal px-3 py-2.5 text-left font-normal text-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground active:scale-[0.98]"
                        >
                          <span className="flex flex-col">
                            <span className="font-medium">{i.name}</span>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {i.available
                                ? formatMoney(i.priceMinor, currency)
                                : t('fnb.soldOutBadge')}
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
          <SectionCard
            className="animate-fade-in lg:sticky lg:top-6 lg:self-start"
            headerClassName="pb-4"
            icon={ShoppingBag}
            title={
              <>
                {t('fnb.newOrder')}
                {cart.length > 0 && (
                  <Badge variant="primary" className="tabular-nums">
                    {cartCount(cart)}
                  </Badge>
                )}
              </>
            }
          >
            <CardContent className="flex flex-col gap-3 text-sm">
              {cart.length === 0 && (
                <p className="rounded-lg border border-dashed py-8 text-center text-muted-foreground">
                  {t('fnb.emptyCart')}
                </p>
              )}
              {cart.map((l, index) => (
                <div
                  key={index}
                  className="flex animate-scale-in flex-col gap-2 rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{l.item.name}</span>
                    <span className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        className="h-8 w-16"
                        aria-label={t('fnb.quantity')}
                        value={l.quantity}
                        onChange={(e) =>
                          update(index, { quantity: Math.max(1, Number(e.target.value) || 1) })
                        }
                      />
                      <span className="w-24 text-right font-medium tabular-nums">
                        {formatMoney(linePrice(l), currency)}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 hover:text-destructive"
                        aria-label={t('fnb.remove')}
                        onClick={() => setCart(cart.filter((_, i) => i !== index))}
                      >
                        <X />
                      </Button>
                    </span>
                  </div>
                  <ModifierPicker
                    groups={l.item.modifierGroups}
                    selected={l.modifierIds}
                    onToggle={(group, id) =>
                      update(index, { modifierIds: toggleModifier(l.modifierIds, group, id) })
                    }
                    formatPrice={(minor) => formatMoney(minor, currency)}
                  />
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <NativeSelect
                  className="w-auto"
                  aria-label={t('fnb.chargeMethod')}
                  value={chargeMethod}
                  onChange={(e) => setChargeMethod(e.target.value as typeof chargeMethod)}
                >
                  <option value="ROOM_CHARGE">{t('fnb.roomCharge')}</option>
                  <option value="PAY_ON_DELIVERY">{t('fnb.payOnDelivery')}</option>
                  <option value="PAY_AT_OUTLET">{t('fnb.payAtOutlet')}</option>
                </NativeSelect>
                <NativeSelect
                  className="w-auto"
                  aria-label={t('fnb.room')}
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                >
                  <option value="">{t('fnb.noRoom')}</option>
                  {rooms.data
                    ?.filter((r) => !r.archived)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.number}
                      </option>
                    ))}
                </NativeSelect>
                <Input
                  className="min-w-40 flex-1"
                  placeholder={t('fnb.notes')}
                  aria-label={t('fnb.notes')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              {place.error && <Alert>{errorMessage(place.error)}</Alert>}
              <Button
                size="lg"
                loading={place.isPending}
                disabled={cart.length === 0}
                onClick={() => place.mutate()}
              >
                {t('fnb.placeOrder')} ·{' '}
                <span className="tabular-nums">{formatMoney(total, currency)}</span>
              </Button>
            </CardContent>
          </SectionCard>
        </div>
      )}

      {cancel.error && <Alert>{errorMessage(cancel.error)}</Alert>}
      {recent.isPending && (
        <Card className="p-4">
          <LoadingRegion label={t('loading')}>
            <SkeletonTable rows={4} columns={5} />
          </LoadingRegion>
        </Card>
      )}
      {recent.data?.length === 0 && (
        <EmptyState icon={<ReceiptText />} title={t('fnb.noActiveOrders')} />
      )}
      {!!recent.data?.length && (
        <Card className="animate-fade-in overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t('fnb.order')}</TableHead>
                <TableHead>{t('fnb.outlet')}</TableHead>
                <TableHead>{t('fnb.room')}</TableHead>
                <TableHead>{t('fnb.status')}</TableHead>
                <TableHead className="text-right">{t('fnb.total')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody className="stagger">
              {recent.data.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.orderNo}</TableCell>
                  <TableCell>{o.outletName}</TableCell>
                  <TableCell>{o.roomNumber ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(o.status)} dot>
                      {statusLabel(o.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(o.totalMinor, o.currency)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right">
                    {can('fnb.order.update') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="hover:text-destructive"
                        loading={cancel.isPending && cancel.variables?.id === o.id}
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(o)}
                      >
                        {t('fnb.cancel')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
