'use client';

import { useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, Card, EmptyState, Icon, Input, Label, Textarea } from '@/components/ui';
import { money } from '@/lib/format';

const EMPTY = { title: '', description: '', price: '' };

function validate(form) {
  const title = form.title.trim();
  if (title.length < 3) return 'Назва має містити щонайменше 3 символи';
  const price = Number(String(form.price).replace(',', '.'));
  if (form.price === '' || Number.isNaN(price) || price < 0) return 'Вкажіть ціну числом (0 або більше)';
  return '';
}

const toPayload = (form) => ({
  title: form.title.trim(),
  description: form.description.trim(),
  price: Number(String(form.price).replace(',', '.')),
});

function ServiceForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(toPayload(form));
      if (!onCancel) setForm(EMPTY);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_130px]">
        <div>
          <Label htmlFor="svc-title">Назва послуги</Label>
          <Input id="svc-title" value={form.title} onChange={set('title')} placeholder="Напр. Консультація з єдиного податку" maxLength={255} />
        </div>
        <div>
          <Label htmlFor="svc-price">Ціна, грн</Label>
          <Input id="svc-price" inputMode="decimal" value={form.price} onChange={set('price')} placeholder="500" />
        </div>
      </div>
      <div>
        <Label htmlFor="svc-desc" hint="(необов’язково)">Опис</Label>
        <Textarea id="svc-desc" rows={2} value={form.description} onChange={set('description')} placeholder="Що входить у консультацію" maxLength={1000} />
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel} disabled={busy}>Скасувати</Button>}
      </div>
    </form>
  );
}

/** Послуги та ціни: GET/POST/PATCH/DELETE /expert/services. Клієнти бачать їх у каталозі фахівців. */
export default function ServicesCard({ services, onChanged }) {
  const [editing, setEditing] = useState(null); // id
  const [removing, setRemoving] = useState(null); // id
  const [removeBusy, setRemoveBusy] = useState(false);
  const [error, setError] = useState('');

  async function add(payload) {
    const created = await api.createService(payload);
    onChanged([...services, created]);
  }

  async function update(id, payload) {
    const updated = await api.updateService(id, payload);
    onChanged(services.map((s) => (s.id === id ? updated : s)));
    setEditing(null);
  }

  async function remove(id) {
    setRemoveBusy(true);
    setError('');
    try {
      await api.deleteService(id);
      onChanged(services.filter((s) => s.id !== id));
      setRemoving(null);
    } catch (e) {
      setError(errorText(e)); // напр. «Не можна видалити послугу, за якою вже є записи»
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-slate-900">Послуги та ціни</h2>
      <p className="mt-0.5 text-xs text-slate-500">Саме їх клієнт обирає, коли записується до вас.</p>

      {error && <Alert className="mt-3">{error}</Alert>}

      {services.length === 0 ? (
        <EmptyState className="mt-4" title="Послуг ще немає">Додайте першу — без неї клієнти не зможуть записатися.</EmptyState>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {services.map((s) => (
            <li key={s.id} className="p-4">
              {editing === s.id ? (
                <ServiceForm
                  initial={{ title: s.title, description: s.description || '', price: String(Number(s.price)) }}
                  submitLabel="Зберегти"
                  onSubmit={(payload) => update(s.id, payload)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-900">{s.title}</p>
                    {s.description && <p className="mt-0.5 text-xs leading-5 text-slate-500">{s.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-2 text-sm font-semibold tabular-nums text-slate-900">{money(s.price)} грн</span>
                    <button type="button" onClick={() => { setEditing(s.id); setRemoving(null); setError(''); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Редагувати «${s.title}»`}>
                      <Icon name="pencil" className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => { setRemoving(s.id); setError(''); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label={`Видалити «${s.title}»`}>
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
              {removing === s.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
                  <span className="text-xs text-red-800">Видалити послугу «{s.title}»?</span>
                  <Button size="sm" variant="danger" loading={removeBusy} onClick={() => remove(s.id)}>Так, видалити</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(null)} disabled={removeBusy}>Ні</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-slate-100 pt-5">
        <h3 className="mb-3 text-[13px] font-semibold text-slate-900">Додати послугу</h3>
        <ServiceForm initial={EMPTY} submitLabel="Додати послугу" onSubmit={add} />
      </div>
    </Card>
  );
}
