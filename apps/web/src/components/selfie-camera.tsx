'use client';

import { cn } from '@hotel/ui';
import { Camera } from 'lucide-react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';

/**
 * The front camera, for the selfie every punch needs (ADR-0022). The stream starts when
 * the component mounts and stops when it unmounts; nothing is recorded until capture().
 */
export function useSelfieCamera(): {
  video: RefObject<HTMLVideoElement | null>;
  ready: boolean;
  error: string | null;
  capture: () => Promise<Blob>;
} {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices) {
      setError(t('clock.noCamera'));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((track) => track.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
        setReady(true);
      })
      .catch(() => setError(t('clock.noCamera')));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  /** One frame as a JPEG, at most 640 px wide. */
  const capture = () => {
    const v = video.current!;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 640 / (v.videoWidth || 640));
    canvas.width = Math.round((v.videoWidth || 640) * scale);
    canvas.height = Math.round((v.videoHeight || 480) * scale);
    canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No image'))), 'image/jpeg', 0.8),
    );
  };

  return { video, ready, error, capture };
}

export function SelfiePreview({
  camera,
  className,
}: {
  camera: ReturnType<typeof useSelfieCamera>;
  className?: string;
}) {
  return (
    <div className={cn('relative aspect-[4/3] overflow-hidden rounded-xl bg-muted', className)}>
      <video
        ref={camera.video}
        autoPlay
        playsInline
        muted
        className="size-full -scale-x-100 object-cover"
        aria-label={t('clock.camera')}
      />
      {!camera.ready && !camera.error && (
        <Camera className="absolute inset-0 m-auto size-10 text-muted-foreground" />
      )}
    </div>
  );
}
