'use client';

import { Alert, Badge, Button, Card, CardContent, Input, Select } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { useProperties } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

export default function EmployeesPage() {
  const session = useSession();
  const [q, setQ] = useState('');
  const employees = useQuery({
    queryKey: ['employees', q],
    queryFn: () => api.hr.employees(q ? { q } : {}),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('hr.employees')}</h1>
        <Input
          className="w-60"
          placeholder={t('hr.search')}
          aria-label={t('hr.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {hasPermission(session.data, 'employee.manage') && <NewEmployee />}
      {employees.error && <Alert>{errorMessage(employees.error)}</Alert>}
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-2">{t('hr.employeeNo')}</th>
            <th>{t('hr.employee')}</th>
            <th>{t('hr.assignments')}</th>
            <th>{t('hr.status')}</th>
          </tr>
        </thead>
        <tbody>
          {employees.data?.map((e) => (
            <tr key={e.id} className="border-t">
              <td className="py-2 font-mono">{e.employeeNo}</td>
              <td>
                <Link className="underline" href={`/hr/employees/${e.id}`}>
                  {e.preferredName || e.firstName} {e.lastName}
                </Link>
              </td>
              <td className="text-muted-foreground">
                {e.assignments
                  .map((a) => `${a.propertyName} · ${a.positionName ?? a.departmentName}`)
                  .join(', ') || '—'}
              </td>
              <td>
                <Badge>{e.status.toLowerCase()}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const create = useMutation({
    mutationFn: () => {
      const propertyId = form.propertyId || properties.data!.items[0]!.id;
      const departmentId = form.departmentId || departments.data![0]!.id;
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
  const department =
    departments.data?.find((d) => d.id === form.departmentId) ?? departments.data?.[0];
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" noValidate>
          <Input
            className="w-24"
            placeholder={t('hr.employeeNo')}
            aria-label={t('hr.employeeNo')}
            value={form.employeeNo}
            onChange={(e) => setForm({ ...form, employeeNo: e.target.value })}
          />
          <Input
            className="w-36"
            placeholder={t('hr.firstName')}
            aria-label={t('hr.firstName')}
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <Input
            className="w-36"
            placeholder={t('hr.lastName')}
            aria-label={t('hr.lastName')}
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
          <Select
            className="w-auto"
            aria-label={t('hr.property')}
            value={form.propertyId}
            onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
          >
            {properties.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            className="w-auto"
            aria-label={t('hr.department')}
            value={form.departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value, positionId: '' })}
          >
            {departments.data
              ?.filter((d) => !d.archived)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </Select>
          <Select
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
          </Select>
          <Button
            type="submit"
            disabled={!form.employeeNo || !form.firstName || !form.lastName || create.isPending}
          >
            {t('hr.addEmployee')}
          </Button>
        </form>
        {create.error && <Alert className="mt-2">{errorMessage(create.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
