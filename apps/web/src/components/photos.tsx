'use client';

import { IMAGE_MAX_PER_PROPERTY, IMAGE_UPLOAD_TYPES } from '@hotel/contracts';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImagePlus, ImageOff, Images, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';

const ACCEPT = IMAGE_UPLOAD_TYPES.join(',');

/** Opens the file picker and hands over the chosen image. */
function useImagePicker(onPick: (file: File) => void) {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      className="sr-only"
      aria-label={t('img.choose')}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) onPick(file);
        e.target.value = '';
      }}
    />
  );
  return { element, open: () => input.current?.click() };
}

/** Hotel photos shown in the guest portal (ADR-0030). */
export function PropertyPhotos({
  propertyId,
  canManage,
}: {
  propertyId: string;
  canManage: boolean;
}) {
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const key = ['property-images', propertyId];
  const images = useQuery({ queryKey: key, queryFn: pms.images });
  const [caption, setCaption] = useState('');
  const set = (items: Awaited<ReturnType<typeof pms.images>>) =>
    queryClient.setQueryData(key, items);
  const upload = useMutation({
    mutationFn: (file: File) => pms.uploadImage(file, caption.trim()),
    onSuccess: (items) => {
      set(items);
      setCaption('');
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; caption?: string; sortOrder?: number }) =>
      pms.updateImage(v.id, { caption: v.caption, sortOrder: v.sortOrder }),
    onSuccess: set,
  });
  const remove = useMutation({
    mutationFn: (id: string) => pms.removeImage(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const picker = useImagePicker((file) => upload.mutate(file));
  const list = images.data ?? [];
  const move = (index: number, by: -1 | 1) => {
    const other = list[index + by];
    const me = list[index];
    if (!other || !me) return;
    update.mutate({ id: me.id, sortOrder: other.sortOrder });
    update.mutate({ id: other.id, sortOrder: me.sortOrder });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Images className="size-4 text-primary" />
          {t('img.photos')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">{t('img.photosHint')}</p>
        {images.error && <Alert>{errorMessage(images.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((img, i) => (
            <figure key={img.id} className="flex flex-col gap-2 rounded-lg border p-2">
              <img
                src={pms.imageUrl(img.id, img.version)}
                alt={img.caption || t('img.photo')}
                className="aspect-video w-full rounded-md bg-muted object-cover"
              />
              {canManage ? (
                <div className="flex items-center gap-1">
                  <Input
                    aria-label={t('img.caption')}
                    placeholder={t('img.caption')}
                    defaultValue={img.caption}
                    maxLength={200}
                    onBlur={(e) =>
                      e.target.value.trim() !== img.caption &&
                      update.mutate({ id: img.id, caption: e.target.value.trim() })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('img.earlier')}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('img.later')}
                    disabled={i === list.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hover:text-destructive"
                    aria-label={t('img.remove')}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(img.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : (
                img.caption && (
                  <figcaption className="text-muted-foreground">{img.caption}</figcaption>
                )
              )}
            </figure>
          ))}
        </div>
        {canManage && list.length < IMAGE_MAX_PER_PROPERTY && (
          <div className="flex flex-wrap items-center gap-2">
            {picker.element}
            <Input
              className="min-w-48 flex-1"
              aria-label={t('img.newCaption')}
              placeholder={t('img.newCaption')}
              maxLength={200}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <Button variant="outline" loading={upload.isPending} onClick={picker.open}>
              {!upload.isPending && <ImagePlus />}
              {t('img.add')}
            </Button>
          </div>
        )}
        {(upload.error || update.error || remove.error) && (
          <Alert>{errorMessage(upload.error ?? update.error ?? remove.error)}</Alert>
        )}
      </CardContent>
    </Card>
  );
}

/** A menu item's photo: thumbnail, replace, remove (ADR-0030). */
export function MenuItemPhoto({
  propertyId,
  itemId,
  version,
  onChanged,
}: {
  propertyId: string;
  itemId: string;
  version: string | null;
  onChanged: () => void;
}) {
  const pms = usePms(propertyId);
  const set = useMutation({
    mutationFn: (file: File) => pms.setMenuItemImage(itemId, file),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => pms.removeMenuItemImage(itemId),
    onSuccess: onChanged,
  });
  const picker = useImagePicker((file) => set.mutate(file));
  return (
    <span className="flex items-center gap-1">
      {picker.element}
      {version ? (
        <img
          src={pms.menuItemImageUrl(itemId, version)}
          alt=""
          className="size-9 rounded-md border object-cover"
        />
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        loading={set.isPending}
        aria-label={version ? t('img.replace') : t('img.addPhoto')}
        title={set.error ? (errorMessage(set.error) ?? undefined) : undefined}
        onClick={picker.open}
      >
        {!set.isPending && <ImagePlus />}
      </Button>
      {version && (
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('img.remove')}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <ImageOff />
        </Button>
      )}
    </span>
  );
}
