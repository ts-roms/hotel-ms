'use client';

import { type CartLine, type MenuItem, newCartLine } from '@hotel/contracts';
import { PageHeader } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { t } from '@/lib/i18n';
import { useCan, usePms, usePropertyId } from '@/lib/property';
import { ActiveOrders } from './_components/active-orders';
import { MenuPicker } from './_components/menu-picker';
import { OrderCart } from './_components/order-cart';

/** Order taking for outlets and phone room service (blueprint §14). */
export default function OrdersPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
  const outlets = useQuery({ queryKey: ['outlets', propertyId], queryFn: pms.outlets });
  const rooms = useQuery({ queryKey: ['rooms', propertyId], queryFn: pms.rooms });
  const [outletId, setOutletId] = useState('');
  const outlet = outletId || outlets.data?.find((o) => o.active)?.id || '';
  const menu = useQuery({
    queryKey: ['menu', propertyId, outlet],
    queryFn: () => pms.menu(outlet),
    enabled: !!outlet,
  });

  const [cart, setCart] = useState<CartLine[]>([]);

  const currency = menu.data?.currency ?? 'PHP';
  // New lines start with the first option of each required group.
  const add = (item: MenuItem) => setCart([...cart, newCartLine(item)]);
  const menuLoading = outlets.isPending || (!!outlet && menu.isPending);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('fnb.orders')} />
      {can('fnb.order.create') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <MenuPicker
            outlets={outlets.data}
            outlet={outlet}
            onOutletChange={(id) => {
              setOutletId(id);
              setCart([]);
            }}
            menu={menu.data}
            loading={menuLoading}
            currency={currency}
            onAdd={add}
          />
          <OrderCart
            outlet={outlet}
            currency={currency}
            rooms={rooms.data}
            cart={cart}
            onCartChange={setCart}
          />
        </div>
      )}

      <ActiveOrders />
    </div>
  );
}
