'use client';

import { useEffect, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, Card, Icon, Input, Label, Select, cx } from '@/components/ui';

const KVED_RE = /^\d{2}\.\d{2}$/;

function normalizeKved(raw) {
  return raw.trim().replace(',', '.');
}

export default function ProfileTab({ user, profile, onSaved }) {
  const [group, setGroup] = useState('');
  const [rate, setRate] = useState('');
  const [kveds, setKveds] = useState([]);
  const [kvedDraft, setKvedDraft] = useState('');
  const [kvedError, setKvedError] = useState('');
  const [employees, setEmployees] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Підтягуємо збережені значення, коли профіль прийшов із сервера
  useEffect(() => {
    if (!profile) return;
    setGroup(profile.tax_group ? String(profile.tax_group) : '');
    setRate(profile.tax_rate != null ? String(Number(profile.tax_rate)) : '');
    setKveds(profile.kveds || []);
    setEmployees(Boolean(profile.has_employees));
  }, [profile]);

  function changeGroup(value) {
    setGroup(value);
    setSaved(false);
    if (value === '3') setRate((r) => (r === '3' || r === '5' ? r : '5'));
    if (value === '1') setEmployees(false);
  }

  function addKveds() {
    const parts = kvedDraft.split(/[\s;]+/).map(normalizeKved).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.find((p) => !KVED_RE.test(p));
    if (bad) {
      setKvedError(`«${bad}» — некоректний КВЕД. Формат: 62.01`);
      return;
    }
    setKvedError('');
    setKveds((prev) => [...prev, ...parts.filter((p) => !prev.includes(p))].slice(0, 20));
    setKvedDraft('');
    setSaved(false);
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaved(false);

    let pending = kveds;
    if (kvedDraft.trim()) {
      const parts = kvedDraft.split(/[\s;]+/).map(normalizeKved).filter(Boolean);
      const bad = parts.find((p) => !KVED_RE.test(p));
      if (bad) {
        setKvedError(`«${bad}» — некоректний КВЕД. Формат: 62.01`);
        return;
      }
      pending = [...kveds, ...parts.filter((p) => !kveds.includes(p))].slice(0, 20);
    }

    const rateValue = String(rate).replace(',', '.').trim();
    if (rateValue !== '' && !Number.isFinite(Number(rateValue))) {
      setError('Ставка має бути числом, наприклад 5.');
      return;
    }

    setSaving(true);
    try {
      await api.saveFopProfile({
        tax_group: group ? Number(group) : null,
        tax_rate: rateValue === '' ? null : Number(rateValue),
        kveds: pending,
        has_employees: group === '1' ? false : employees,
      });
      setKveds(pending);
      setKvedDraft('');
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">Мій профіль ФОП</h2>
        <p className="mt-1 text-sm text-slate-500">
          Ці параметри визначають ваш ліміт доходу, податковий календар і те, як ШІ-помічник пояснює норми.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="pf-group">Група єдиного податку</Label>
              <Select id="pf-group" value={group} onChange={(e) => changeGroup(e.target.value)}>
                <option value="">Не вказано</option>
                <option value="1">I група</option>
                <option value="2">II група</option>
                <option value="3">III група</option>
              </Select>
            </div>

            <div>
              <Label htmlFor="pf-rate" hint="%">Ставка податку</Label>
              {group === '3' ? (
                <Select id="pf-rate" value={rate} onChange={(e) => { setRate(e.target.value); setSaved(false); }}>
                  <option value="5">5% (без ПДВ)</option>
                  <option value="3">3% (платник ПДВ)</option>
                </Select>
              ) : (
                <Input
                  id="pf-rate"
                  inputMode="decimal"
                  placeholder={group === '1' ? 'до 10% прожиткового мінімуму' : group === '2' ? 'до 20% мінімальної зарплати' : 'Спершу оберіть групу'}
                  value={rate}
                  disabled={!group}
                  onChange={(e) => { setRate(e.target.value); setSaved(false); }}
                />
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="pf-kved" hint="формат 62.01">КВЕДи</Label>
            <div className="flex gap-2">
              <Input
                id="pf-kved"
                value={kvedDraft}
                placeholder="Введіть код і натисніть Enter"
                onChange={(e) => { setKvedDraft(e.target.value); setKvedError(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addKveds();
                  }
                }}
              />
              <Button onClick={addKveds} disabled={!kvedDraft.trim()}>
                <Icon name="plus" className="h-4 w-4" /> Додати
              </Button>
            </div>
            {kvedError && <p className="mt-1.5 text-xs text-red-600">{kvedError}</p>}
            {kveds.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {kveds.map((k) => (
                  <li key={k} className="flex items-center gap-1 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1 text-xs font-medium text-slate-700">
                    {k}
                    <button
                      type="button"
                      onClick={() => { setKveds((prev) => prev.filter((x) => x !== k)); setSaved(false); }}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                      aria-label={`Видалити КВЕД ${k}`}
                    >
                      <Icon name="x" className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className={cx('flex items-start gap-3 rounded-xl border border-slate-200 p-3.5', group === '1' ? 'cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50')}>
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-blue-600"
              checked={group === '1' ? false : employees}
              disabled={group === '1'}
              onChange={(e) => { setEmployees(e.target.checked); setSaved(false); }}
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">Маю найманих працівників</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                {group === '1'
                  ? 'Платники єдиного податку I групи не можуть мати найманих працівників.'
                  : 'Додає у ваш календар нагадування про строки, пов’язані зі штатом, і підказку звернутися до бухгалтера.'}
              </span>
            </span>
          </label>

          {error && <Alert>{error}</Alert>}
          {saved && <Alert tone="green">Профіль збережено. Ліміт, календар і підказки ШІ вже оновлено.</Alert>}

          <Button type="submit" variant="primary" size="lg" loading={saving}>Зберегти профіль</Button>
        </form>
      </Card>

      <div className="space-y-5">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-900">Акаунт</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-slate-400">Ім’я</dt>
              <dd className="text-slate-800">{user?.full_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Email</dt>
              <dd className="break-all text-slate-800">{user?.email}</dd>
            </div>
          </dl>
        </Card>
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon name="shield" className="h-4 w-4 text-blue-600" /> Куди йдуть ці дані
          </h3>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
            <li>• ШІ-помічник бере групу, ставку та КВЕДи, щоб вибирати релевантні положення статей.</li>
            <li>• Фахівець бачить ці параметри лише в заявках, які ви йому надсилаєте.</li>
            <li>• Платформа не підключена до ДПС чи банків — усе рахується з ваших власних даних.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
