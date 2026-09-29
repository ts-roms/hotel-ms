'use client';

import { KitchenBoard } from '@/components/kitchen-board/kitchen-board';
import { useCan, usePms, usePropertyId } from '@/lib/property';

export default function KitchenPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
  return <KitchenBoard propertyId={propertyId} pms={pms} can={can} />;
}
