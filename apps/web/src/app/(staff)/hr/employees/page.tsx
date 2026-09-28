'use client';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Input,
  LoadingRegion,
  PageHeader,
  NativeSelect,
  SkeletonRow,
} from '@hotel/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, IdCard, Search, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { useProperties } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel, statusVariant } from '@/lib/status';

export default function EmployeesPage() {
  const session = useSession();
  const [q, setQ] = useState('');
  const employees = useQuery({
    queryKey: ['employees', q],
    queryFn: () => api.hr.employees(q ? { q } : {}),
    // Keep the current list on screen while the search runs.
    placeholderData: keepPreviousData,
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('hr.employees')}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 w-64 pl-9"
              placeholder={t('hr.search')}
              aria-label={t('hr.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        }
      />
      {hasPermission(session.data, 'employee.manage') && <NewEmployee />}
      {employees.error && <Alert>{errorMessage(employees.error)}</Alert>}
      {employees.isPending && (
        <LoadingRegion label={t('loading')} className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </LoadingRegion>
      )}
      {employees.data?.length === 0 && <EmptyState icon={<IdCard />} title={t('hr.noEmployees')} />}
      <ul
        className={cn(
          'stagger flex flex-col gap-2 transition-opacity',
          employees.isPlaceholderData && 'opacity-60',
        )}
      >
        {employees.data?.map((e) => {
          const name = `${e.preferredName || e.firstName} ${e.lastName}`;
          return (
            <li key={e.id}>
              <Link
                href={`/hr/employees/${e.id}`}
                className="hover-lift group flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 text-sm shadow-sm shadow-black/3"
              >
                <Avatar name={name} />
                <div className="flex min-w-40 flex-1 flex-col">
                  <span className="font-medium">{name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{e.employeeNo}</span>
                </div>
                <span className="text-muted-foreground">
                  {e.assignments
                    .map((a) => `${a.propertyName} · ${a.positionName ?? a.departmentName}`)
                    .join(', ') || '—'}
                </span>
                <Badge variant={statusVariant(e.status)} dot>
                  {statusLabel(e.status)}
                </Badge>
                <ArrowRight className="size-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewEmployee() {
  const queryClient = useQueryClient();
  const properties = useProperties();
  const departments = useQuery({ queryKey: ['departments'], queryFn: api.hr.departments });
  const [form, setForm] = useState({
    employeeNo: '',
    firstName: '',
    lastName: '',
    propertyId: '',
    departmentId: '',
    positionId: '',
  });
  // '' means "not chosen yet": show and submit the first option. Options load after the
  // first render, so the selects must be given that option explicitly or they show blank.
  const activeDepartments = departments.data?.filter((d) => !d.archived) ?? [];
  const propertyId = form.propertyId || properties.data?.items[0]?.id || '';
  const department =
    activeDepartments.find((d) => d.id === form.departmentId) ?? activeDepartments[0];
  const departmentId = department?.id ?? '';
  const create = useMutation({
    mutationFn: () => {
      return api.hr.createEmployee({
        employeeNo: form.employeeNo,
        firstName: form.firstName,
        lastName: form.lastName,
        preferredName: null,
        workEmail: null,
        workPhone: null,
        hireDate: today(),
        birthdayVisibility: 'HIDDEN',
        assignment: {
          propertyId,
          departmentId,
          positionId: form.positionId || null,
          startDate: today(),
          endDate: null,
          isPrimary: true,
        },
      });
    },
    onSuccess: () => {
      setForm({ ...form, employeeNo: '', firstName: '', lastName: '' });
      return queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="size-4 text-primary" />
          {t('hr.addEmployee')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" noValidate>
          <Input
            className="w-28"
            placeholder={t('hr.employeeNo')}
            aria-label={t('hr.employeeNo')}
            value={form.employeeNo}
            onChange={(e) => setForm({ ...form, employeeNo: e.target.value })}
          />
          <Input
            className="w-40"
            placeholder={t('hr.firstName')}
            aria-label={t('hr.firstName')}
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <Input
            className="w-40"
            placeholder={t('hr.lastName')}
            aria-label={t('hr.lastName')}
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
          <NativeSelect
            className="w-auto"
            aria-label={t('hr.property')}
            value={propertyId}
            onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
          >
            {properties.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            className="w-auto"
            aria-label={t('hr.department')}
            value={departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value, positionId: '' })}
          >
            {activeDepartments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            className="w-auto"
            aria-label={t('hr.position')}
            value={form.positionId}
            onChange={(e) => setForm({ ...form, positionId: e.target.value })}
          >
            <option value="">—</option>
            {department?.positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="submit"
            loading={create.isPending}
            disabled={
              !form.employeeNo || !form.firstName || !form.lastName || !propertyId || !departmentId
            }
          >
            {t('hr.addEmployee')}
          </Button>
        </form>
        {create.error && <Alert className="mt-2">{errorMessage(create.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
