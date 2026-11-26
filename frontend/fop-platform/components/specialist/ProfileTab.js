'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Avatar, Badge, Button, Card, Icon, Input, Label, Select, Skeleton, Textarea } from '@/components/ui';
import { SPECIALIZATION_LABEL, money, plural } from '@/lib/format';
import ServicesCard from '@/components/specialist/ServicesCard';

const BIO_MAX = 2000;

function toForm(p) {
  return {
    full_name: p.full_name || '',
    specialization: p.specialization || '',
    headline: p.headline || '',
    bio: p.bio || '',
    experience_years: p.experience_years == null ? '' : String(p.experience_years),
  };
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

/** Профіль спеціаліста: спеціалізація, опис, стаж, лічильник консультацій і послуги. */
export default function ProfileTab({ onSaved }) {
  const [state, setState] = useState({ loading: true, error: '', profile: null });
  const [services, setServices] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const [profile, list] = await Promise.all([api.getExpertProfile(), api.listMyServices()]);
      setServices(list);
      setForm(toForm(profile));
      setState({ loading: false, error: '', profile });
    } catch (e) {
      setState({ loading: false, error: errorText(e), profile: null });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { profile } = state;
  const dirty = Boolean(profile && form) && JSON.stringify(form) !== JSON.stringify(toForm(profile));
  const set = (k) => (e) => {
    setJustSaved(false);
    setSaveError('');
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  async function save(e) {
    e.preventDefault();
    if (form.full_name.trim().length < 2) {
      setSaveError('Вкажіть імʼя та прізвище (мінімум 2 символи)');
      return;
    }
    const years = form.experience_years.trim();
    if (years !== '' && (!/^\d+$/.test(years) || Number(years) > 70)) {
      setSaveError('Стаж — ціле число від 0 до 70');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const patch = {
        full_name: form.full_name.trim(),
        headline: form.headline.trim(),
        bio: form.bio.trim(),
        experience_years: years === '' ? null : Number(years),
      };
      if (form.specialization) patch.specialization = form.specialization;
      const updated = await api.saveExpertProfile(patch);
      setState({ loading: false, error: '', profile: updated });
      setForm(toForm(updated));
      setJustSaved(true);
      onSaved?.(updated);
    } catch (err) {
      setSaveError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  // Послуги змінюють і чек-лист налаштування на «Огляді», тож повідомляємо сторінку
  const onServicesChanged = (next) => {
    setServices(next);
    setState((s) => (s.profile ? { ...s, profile: { ...s.profile, services_count: next.length } } : s));
    onSaved?.();
  };

  if (state.loading && !profile) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Skeleton className="h-96" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (state.error && !profile) {
    return (
      <Alert action={<button type="button" onClick={load} className="shrink-0 text-xs font-medium underline">Спробувати ще раз</button>}>
        {state.error}
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Мій профіль</h1>
        <p className="mt-1 text-sm text-slate-500">Так вас бачать клієнти в каталозі фахівців.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-5">
            <form onSubmit={save} className="space-y-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="p-name">Імʼя та прізвище</Label>
                  <Input id="p-name" value={form.full_name} onChange={set('full_name')} maxLength={255} />
                </div>
                <div>
                  <Label htmlFor="p-spec">Спеціалізація</Label>
                  <Select id="p-spec" value={form.specialization} onChange={set('specialization')}>
                    {!form.specialization && <option value="">Не вказано</option>}
                    {Object.entries(SPECIALIZATION_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                <div>
                  <Label htmlFor="p-head" hint="(коротко, до 255 символів)">Заголовок</Label>
                  <Input id="p-head" value={form.headline} onChange={set('headline')} maxLength={255} placeholder="Напр. Бухгалтер ФОП: єдиний податок, звітність" />
                </div>
                <div>
                  <Label htmlFor="p-exp" hint="(років)">Стаж</Label>
                  <Input id="p-exp" inputMode="numeric" value={form.experience_years} onChange={set('experience_years')} placeholder="7" />
                </div>
              </div>
              <div>
                <Label htmlFor="p-bio">Про себе та послуги</Label>
                <Textarea id="p-bio" rows={6} maxLength={BIO_MAX} value={form.bio} onChange={set('bio')} placeholder="З якими питаннями допомагаєте, який досвід маєте, як проходить консультація" />
                <p className="mt-1 text-right text-[11px] text-slate-400">{form.bio.length} / {BIO_MAX}</p>
              </div>

              {saveError && <Alert>{saveError}</Alert>}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>Зберегти профіль</Button>
                {justSaved && !dirty && (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                    <Icon name="check" className="h-4 w-4" /> Збережено
                  </span>
                )}
                {dirty && !saving && <span className="text-xs text-amber-600">Є незбережені зміни</span>}
              </div>
            </form>
          </Card>

          <ServicesCard services={services} onChanged={onServicesChanged} />
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">У цифрах</h2>
            <div className="grid grid-cols-3 gap-3 lg:grid-cols-1 xl:grid-cols-3">
              <Stat label="Проведено" value={profile.completed_count} />
              <Stat label="Усього записів" value={profile.total_count} />
              <Stat label="Послуг" value={profile.services_count} />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Рахуються реальні записи: проведені консультації та всі записи, окрім відхилених і скасованих.
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Так вас бачать клієнти</h2>
            <div className="flex items-start gap-3">
              <Avatar name={form.full_name} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{form.full_name || '—'}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {form.specialization && <Badge tone="blue">{SPECIALIZATION_LABEL[form.specialization]}</Badge>}
                  {form.experience_years !== '' && /^\d+$/.test(form.experience_years) && (
                    <span className="text-xs text-slate-500">Стаж {plural(Number(form.experience_years), 'рік', 'роки', 'років')}</span>
                  )}
                </div>
              </div>
            </div>
            {form.headline && <p className="mt-3 text-[13px] font-medium text-slate-800">{form.headline}</p>}
            {form.bio && <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-600">{form.bio}</p>}
            {services.length > 0 ? (
              <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                {services.slice(0, 4).map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-slate-700">{s.title}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">{money(s.price)} грн</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-amber-700">Додайте послугу, щоб клієнти могли записатися.</p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
