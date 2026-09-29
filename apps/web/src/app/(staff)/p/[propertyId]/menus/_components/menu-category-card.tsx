'use client';

import type { MenuCategory, UpdateMenuItemRequest } from '@hotel/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from '@hotel/ui';
import { MenuItemPhoto } from '@/components/photos';
import { t } from '@/lib/i18n';
import { PriceEditor } from './price-editor';

/** One menu category with its items: price, photo, availability and archiving. */
export function MenuCategoryCard({
  category: c,
  propertyId,
  currency,
  updating,
  updatePending,
  onUpdate,
  onPhotoChanged,
}: {
  category: MenuCategory;
  propertyId: string;
  currency: string;
  /** Only the button that started the change shows a spinner. */
  updating: (id: string, field: 'available' | 'archived' | 'priceMinor') => boolean;
  updatePending: boolean;
  onUpdate: (id: string, body: UpdateMenuItemRequest) => void;
  onPhotoChanged: () => void;
}) {
  return (
    <Card>
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
            <span className={i.archived ? 'text-muted-foreground line-through' : 'font-medium'}>
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
              <MenuItemPhoto
                propertyId={propertyId}
                itemId={i.id}
                version={i.imageVersion}
                onChanged={onPhotoChanged}
              />
              <PriceEditor
                value={i.priceMinor}
                currency={currency}
                saving={updating(i.id, 'priceMinor')}
                onSave={(priceMinor) => onUpdate(i.id, { priceMinor })}
              />
              <Button
                size="sm"
                variant="ghost"
                loading={updating(i.id, 'available')}
                disabled={updatePending}
                onClick={() => onUpdate(i.id, { available: !i.available })}
              >
                {i.available ? t('fnb.markSoldOut') : t('fnb.markAvailable')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={updating(i.id, 'archived')}
                disabled={updatePending}
                onClick={() => onUpdate(i.id, { archived: !i.archived })}
              >
                {i.archived ? t('fnb.restore') : t('fnb.archive')}
              </Button>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
