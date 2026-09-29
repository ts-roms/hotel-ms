'use client';

import { IMPORT_COLUMNS, type ImportKind, type ImportPreview } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  NativeSelect,
  Notice,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { Download, FileUp, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

const KINDS: { kind: ImportKind; label: 'imp.guests' | 'imp.rooms'; permission: string }[] = [
  { kind: 'guests', label: 'imp.guests', permission: 'guest.update' },
  { kind: 'rooms', label: 'imp.rooms', permission: 'room.manage' },
];

const STATUS_VARIANT = { NEW: 'success', DUPLICATE: 'warning', ERROR: 'danger' } as const;

/** A header-only CSV to fill in, as a download. */
function templateHref(kind: ImportKind): string {
  const header = IMPORT_COLUMNS[kind].map((c) => c.replace(/\*$/, '')).join(',');
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`${header}\n`)}`;
}

/** CSV import with a preview before anything is written (spec §74, ADR-0030). */
export default function ImportPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const session = useSession();
  const kinds = KINDS.filter((k) => hasPermission(session.data, k.permission));
  const [kind, setKind] = useState<ImportKind | ''>('');
  const current = kind || kinds[0]?.kind || 'guests';
  const [fileName, setFileName] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const preview = useMutation({
    mutationFn: async (file: File) => pms.importPreview(current, await file.text()),
  });
  const commit = useMutation({
    mutationFn: (p: ImportPreview) => pms.importCommit(p.kind, p.token),
    onSuccess: () => preview.reset(),
  });
  const p = preview.data;
  const columns = p?.sample[0] ? Object.keys(p.sample[0].values) : [];

  const choose = (k: ImportKind) => {
    setKind(k);
    preview.reset();
    commit.reset();
    setFileName('');
  };

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <PageHeader title={t('imp.title')} description={t('imp.hint')} />
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 text-sm">
          <div className="flex flex-wrap items-end gap-3">
            <Label className="flex flex-col gap-1">
              {t('imp.what')}
              <NativeSelect value={current} onChange={(e) => choose(e.target.value as ImportKind)}>
                {kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {t(k.label)}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Button variant="outline" asChild>
              <a href={templateHref(current)} download={`${current}-template.csv`}>
                <Download />
                {t('imp.template')}
              </a>
            </Button>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label={t('imp.file')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setFileName(file.name);
                  commit.reset();
                  preview.mutate(file);
                }
                e.target.value = '';
              }}
            />
            <Button loading={preview.isPending} onClick={() => input.current?.click()}>
              {!preview.isPending && <FileUp />}
              {t('imp.choose')}
            </Button>
          </div>
          <p className="text-muted-foreground">
            {t('imp.columns')}{' '}
            <span className="font-mono">{IMPORT_COLUMNS[current].join(', ')}</span>.{' '}
            {t('imp.required')}
          </p>
          {preview.error && <Alert>{errorMessage(preview.error)}</Alert>}
          {commit.error && <Alert>{errorMessage(commit.error)}</Alert>}
          {commit.data && (
            <Notice>
              {commit.data.created} {t('imp.created')}
              {commit.data.skipped > 0 && `, ${commit.data.skipped} ${t('imp.skipped')}`}.
            </Notice>
          )}
        </CardContent>
      </Card>

      {p && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {t('imp.preview')}{' '}
              <span className="font-normal text-muted-foreground">{fileName}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">
                {p.newRows} {t('imp.new')}
              </Badge>
              <Badge variant="warning">
                {p.duplicateRows} {t('imp.duplicates')}
              </Badge>
              <Badge variant={p.errorRows ? 'danger' : 'neutral'}>
                {p.errorRows} {t('imp.errors')}
              </Badge>
            </div>
            {p.errorRows > 0 ? (
              <Alert>
                <p className="font-medium">{t('imp.fixErrors')}</p>
                <ul className="mt-1 list-disc pl-5">
                  {p.errors.map((e) => (
                    <li key={`${e.row}:${e.column}:${e.message}`}>
                      {t('imp.row')} {e.row}
                      {e.column && ` · ${e.column}`}: {e.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  loading={commit.isPending}
                  disabled={p.newRows === 0}
                  onClick={() => commit.mutate(p)}
                >
                  {!commit.isPending && <Upload />}
                  {t('imp.commit')} ({p.newRows})
                </Button>
                <span className="text-muted-foreground">
                  {t('imp.validUntil')} {new Date(p.expiresAt).toLocaleTimeString('en-PH')}
                </span>
              </div>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('imp.row')}</TableHead>
                    <TableHead>{t('imp.status')}</TableHead>
                    {columns.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.sample.map((r) => (
                    <TableRow key={r.row}>
                      <TableCell className="tabular-nums">{r.row}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[r.status]}>
                          {t(`imp.status.${r.status}` as 'imp.status.NEW')}
                        </Badge>
                      </TableCell>
                      {columns.map((c) => (
                        <TableCell key={c} className="max-w-48 truncate">
                          {r.values[c]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {p.totalRows > p.sample.length && (
              <p className="text-muted-foreground">
                {t('imp.showing')} {p.sample.length} / {p.totalRows}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
