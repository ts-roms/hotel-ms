'use client';

import {
  EMPLOYEE_DOCUMENT_CATEGORIES,
  EMPLOYEE_DOCUMENT_MAX_BYTES,
  EMPLOYEE_DOCUMENT_TYPES,
} from '@hotel/contracts';
import { formatDate } from '@hotel/format';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  CardContent,
  Input,
  Label,
  NativeSelect,
  SectionCard,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { DOCUMENT_CATEGORY_LABELS } from '@/lib/hr';
import { t } from '@/lib/i18n';

const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Contracts, IDs and certificates (ADR-0019). Needs employee.documents and a 2FA session. */
export function EmployeeDocuments({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const documents = useQuery({
    queryKey: ['employee-documents', employeeId],
    queryFn: () => api.hr.documents(employeeId),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>('CONTRACT');
  const [title, setTitle] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [tooLarge, setTooLarge] = useState(false);
  const upload = useMutation({
    mutationFn: () =>
      api.hr.uploadDocument(employeeId, file!, {
        category,
        title: title.trim(),
        fileName: file!.name,
        ...(expiresOn ? { expiresOn } : {}),
      }),
    onSuccess: () => {
      setFile(null);
      setTitle('');
      setExpiresOn('');
      if (fileInput.current) fileInput.current.value = '';
      return refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (documentId: string) => api.hr.deleteDocument(employeeId, documentId),
    onSuccess: refresh,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file && title.trim()) upload.mutate();
  };

  return (
    <SectionCard icon={FileText} title={t('hr.documents')}>
      <CardContent className="flex flex-col gap-3 text-sm">
        {documents.error && <Alert>{errorMessage(documents.error)}</Alert>}
        {documents.data?.length === 0 && (
          <p className="text-muted-foreground">{t('hr.noDocuments')}</p>
        )}
        {documents.data?.map((d) => (
          <div
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <a
                  className="font-medium underline-offset-2 hover:underline"
                  href={api.hr.documentUrl(employeeId, d.id)}
                >
                  {d.title}
                </a>
                <Badge>{DOCUMENT_CATEGORY_LABELS[d.category]}</Badge>
              </span>
              <span className="text-xs text-muted-foreground">
                {d.fileName} · {sizeLabel(d.sizeBytes)} · {formatDate(d.createdAt.slice(0, 10))}
                {d.uploadedByName && ` · ${d.uploadedByName}`}
                {d.expiresOn && ` · ${t('hr.expires')} ${formatDate(d.expiresOn)}`}
                {d.purgeOn && ` · ${t('hr.deletedOn')} ${formatDate(d.purgeOn)}`}
              </span>
            </span>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="hover:text-destructive"
                  disabled={remove.isPending}
                >
                  {t('hr.delete')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('hr.deleteDocumentConfirm')}</AlertDialogTitle>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('hr.cancel')}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => remove.mutate(d.id)}>
                    {t('hr.delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
        {remove.error && <Alert>{errorMessage(remove.error)}</Alert>}

        {!documents.error && (
          <form onSubmit={submit} className="grid gap-2 border-t pt-3 sm:grid-cols-2">
            <Input
              ref={fileInput}
              type="file"
              required
              aria-label={t('hr.file')}
              accept={EMPLOYEE_DOCUMENT_TYPES.join(',')}
              className="sm:col-span-2 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium"
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setTooLarge(!!chosen && chosen.size > EMPLOYEE_DOCUMENT_MAX_BYTES);
                setFile(chosen);
                if (chosen && !title) setTitle(chosen.name.replace(/\.[^.]+$/, ''));
              }}
            />
            <NativeSelect
              aria-label={t('hr.category')}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {EMPLOYEE_DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {DOCUMENT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
            <Input
              required
              maxLength={120}
              aria-label={t('hr.documentTitle')}
              placeholder={t('hr.documentTitle')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Label className="flex items-center gap-2 font-normal text-muted-foreground">
              {t('hr.expiresOptional')}
              <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </Label>
            <Button
              type="submit"
              variant="outline"
              loading={upload.isPending}
              disabled={!file || tooLarge || !title.trim()}
            >
              {t('hr.upload')}
            </Button>
            {tooLarge && <Alert className="sm:col-span-2">{t('hr.fileTooLarge')}</Alert>}
            {upload.error && <Alert className="sm:col-span-2">{errorMessage(upload.error)}</Alert>}
          </form>
        )}
      </CardContent>
    </SectionCard>
  );
}
