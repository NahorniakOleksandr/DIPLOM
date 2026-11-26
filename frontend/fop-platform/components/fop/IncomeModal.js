'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, EmptyState, Icon, Input, Label, Modal, Skeleton } from '@/components/ui';
import { money, moneyExact, parseDateOnly, todayIso } from '@/lib/format';

export default function IncomeModal({ open, onClose, year, onChanged }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setData(await api.listIncome(year));
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, [year]);

  useEffect(() => {
    if (open) {
      setData(null);
      setFormError('');
      setDate(todayIso());
      load();
    }
  }, [open, load]);

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    const value = Number(String(amount).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setFormError('Вкажіть суму надходження більшу за нуль.');
      return;
    }
    if (!date) {
      setFormError('Вкажіть дату надходження.');
      return;
    }
    setSaving(true);
    try {
      await api.addIncome({ amount: value.toFixed(2), received_on: date, note: note.trim() });
      setAmount('');
      setNote('');
      await load();
      onChanged();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    setDeleting(id);
    setFormError('');
    try {
      await api.deleteIncome(id);
      await load();
      onChanged();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Оновити дохід"
      subtitle={`Надходження за ${year} рік. Ліміт рахується з цих записів.`}
      footer={<Button onClick={onClose}>Готово</Button>}
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="inc-amount" hint="грн">Сума надходження</Label>
            <Input id="inc-amount" inputMode="decimal" placeholder="напр. 45 000" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="inc-date">Дата</Label>
            <Input id="inc-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="inc-note" hint="необов'язково">Примітка</Label>
          <Input id="inc-note" maxLength={255} placeholder="Напр.: оплата за договором №12" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {formError && <Alert>{formError}</Alert>}
        <Button type="submit" variant="primary" loading={saving}>
          <Icon name="plus" className="h-4 w-4" /> Додати надходження
        </Button>
        <p className="text-[11px] leading-4 text-slate-400">
          Якщо дохід уже був на початку року — додайте його одним записом із відповідною датою.
        </p>
      </form>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Записи</h3>
          {data && <span className="text-xs text-slate-500">Разом: <b className="text-slate-900">{money(data.total)} грн</b></span>}
        </div>

        {loadError && <Alert action={<button onClick={load} className="text-xs font-medium underline">Повторити</button>}>{loadError}</Alert>}
        {!data && !loadError && <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
        {data && data.entries.length === 0 && (
          <EmptyState title="Поки немає надходжень">Додайте перше — лічильник ліміту одразу оновиться.</EmptyState>
        )}
        {data && data.entries.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {data.entries.map((it) => (
              <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900 tabular-nums">{moneyExact(it.amount)} грн</div>
                  <div className="truncate text-xs text-slate-500">
                    {parseDateOnly(it.received_on)?.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}
                    {it.note ? ` · ${it.note}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  disabled={deleting === it.id}
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  aria-label="Видалити запис"
                  title="Видалити"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
