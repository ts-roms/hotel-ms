'use client';

import {
  EMPLOYEE_DOCUMENT_CATEGORIES,
  EMPLOYEE_DOCUMENT_MAX_BYTES,
  EMPLOYEE_DOCUMENT_TYPES,
} from '@hotel/contracts';
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
import { FileText } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

const CATEGORY_LABELS: Record<(typeof EMPLOYEE_DOCUMENT_CATEGORIES)[number], string> = {
  CONTRACT: 'Contract',
  GOVERNMENT_ID: 'Government ID',
  TAX: 'Tax',
  MEDICAL: 'Medical',
  CERTIFICATE: 'Certificate',
  OTHER: 'Other',
};

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4 text-primary" />
          {t('hr.documents')}
        </CardTitle>
      </CardHeader>
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
                <Badge>{CATEGORY_LABELS[d.category]}</Badge>
              </span>
              <span className="text-xs text-muted-foreground">
                {d.fileName} · {sizeLabel(d.sizeBytes)} · {formatDate(d.createdAt.slice(0, 10))}
                {d.uploadedByName && ` · ${d.uploadedByName}`}
                {d.expiresOn && ` · ${t('hr.expires')} ${formatDate(d.expiresOn)}`}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="hover:text-destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(t('hr.deleteDocumentConfirm'))) remove.mutate(d.id);
              }}
            >
              {t('hr.delete')}
            </Button>
          </div>
        ))}
        {remove.error && <Alert>{errorMessage(remove.error)}</Alert>}

        {!documents.error && (
          <form onSubmit={submit} className="grid gap-2 border-t pt-3 sm:grid-cols-2">
            <input
              ref={fileInput}
              type="file"
              required
              aria-label={t('hr.file')}
              accept={EMPLOYEE_DOCUMENT_TYPES.join(',')}
              className="text-sm sm:col-span-2"
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setTooLarge(!!chosen && chosen.size > EMPLOYEE_DOCUMENT_MAX_BYTES);
                setFile(chosen);
                if (chosen && !title) setTitle(chosen.name.replace(/\.[^.]+$/, ''));
              }}
            />
            <Select
              aria-label={t('hr.category')}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {EMPLOYEE_DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
            <Input
              required
              maxLength={120}
              aria-label={t('hr.documentTitle')}
              placeholder={t('hr.documentTitle')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <label className="flex items-center gap-2 text-muted-foreground">
              {t('hr.expiresOptional')}
              <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </label>
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
    </Card>
  );
}
