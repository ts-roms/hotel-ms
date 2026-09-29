'use client';

import { type GuestStay } from '@hotel/contracts';
import { CardContent, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronDown, Sparkles, Wifi } from 'lucide-react';
import { Section } from '@/components/section';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

/**
 * About the hotel (ADR-0027): what it offers, its services, the Wi-Fi once checked in, house
 * rules.
 */
export function HotelInfo({ stay: s }: { stay: GuestStay }) {
  // The Wi-Fi appears once the guest is verified and in house: refetch when either changes.
  const info = useQuery({
    queryKey: ['hotel-info', s.verified, s.stay.status],
    queryFn: api.hotelInfo,
    retry: false,
  });
  const h = info.data;
  if (!h) return null;
  const empty =
    !h.about &&
    h.amenities.length === 0 &&
    h.services.length === 0 &&
    !h.houseRules &&
    !h.wifi &&
    h.images.length === 0;
  if (empty) return null;
  return (
    <Section
      icon={<Building2 />}
      title={t('info.title', { name: h.name })}
      description={h.address || undefined}
    >
      <CardContent className="flex flex-col gap-4 text-sm">
        {h.images.length > 0 && (
          <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1">
            {h.images.map((img) => (
              <figure key={img.id} className="w-64 shrink-0 snap-start">
                <img
                  src={api.hotelImageUrl(img.id, img.version)}
                  alt={img.caption || h.name}
                  loading="lazy"
                  className="aspect-video w-full rounded-xl bg-muted object-cover"
                />
                {img.caption && (
                  <figcaption className="mt-1 text-xs text-muted-foreground">
                    {img.caption}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        )}
        {h.about && <p className="whitespace-pre-wrap">{h.about}</p>}
        {h.wifi && (
          <div className="flex items-start gap-3 rounded-xl border p-3">
            <Wifi className="mt-0.5 size-4 text-primary" />
            <div>
              <p className="font-medium">{h.wifi.name}</p>
              <p className="text-muted-foreground">
                {t('info.wifiPassword')}{' '}
                <span className="font-mono text-foreground">{h.wifi.password}</span>
              </p>
            </div>
          </div>
        )}
        {h.amenities.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {h.amenities.map((a) => (
              <span
                key={a}
                className="flex items-center gap-1 rounded-full border px-3 py-1 text-xs"
              >
                <Sparkles className="size-3 text-primary" />
                {a}
              </span>
            ))}
          </div>
        )}
        {h.services.length > 0 && (
          <ul className="flex flex-col divide-y rounded-xl border">
            {h.services.map((service) => (
              <li key={service.name} className="flex flex-col gap-0.5 p-3">
                <span className="flex justify-between gap-2">
                  <span className="font-medium">{service.name}</span>
                  {service.hours && (
                    <span className="text-xs text-muted-foreground">{service.hours}</span>
                  )}
                </span>
                {service.description && (
                  <span className="text-muted-foreground">{service.description}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {h.houseRules && (
          <Collapsible className="group rounded-xl border p-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md text-left font-medium focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25">
              {t('info.houseRules')}
              <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="animate-fade-in">
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{h.houseRules}</p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Section>
  );
}
