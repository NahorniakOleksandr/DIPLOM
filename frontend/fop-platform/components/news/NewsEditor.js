'use client';

import { useEffect, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, Input, Label, Modal, Select, Textarea } from '@/components/ui';
import { CATEGORY_OPTIONS } from '@/components/news/newsMeta';

const EMPTY = { title: '', body: '', category: 'law_change', importance: 'normal', effective_date: '', source_url: '' };
const TITLE_MIN = 5;
const BODY_MIN = 20;
const BODY_MAX = 10000;

const fromItem = (n) => ({
  title: n.title,
  body: n.body,
  category: n.category,
  importance: n.importance,
  effective_date: n.effective_date || '',
  source_url: n.source_url || '',
});

function validate(f) {
  if (f.title.trim().length < TITLE_MIN) return `Заголовок: мінімум ${TITLE_MIN} символів`;
  if (f.body.trim().length < BODY_MIN) return `Текст: мінімум ${BODY_MIN} символів`;
  if (f.body.length > BODY_MAX) return `Текст завеликий (максимум ${BODY_MAX} символів)`;
  if (f.source_url.trim() && !/^https?:\/\/\S+$/i.test(f.source_url.trim())) {
    return 'Посилання має починатися з http:// або https://';
  }
  return '';
}

/** Створення або редагування статті. initial — повна новина (з body) для редагування, null — нова. */
export default function NewsEditor({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editing = Boolean(initial);

  useEffect(() => {
    if (open) {
      setForm(initial ? fromItem(initial) : EMPTY);
      setError('');
      setBusy(false);
    }
  }, [open, initial]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    const payload = {
      title: form.title.trim(),
      body: form.body.trim(),
      category: form.category,
      importance: form.importance,
      effective_date: form.effective_date || null,
      source_url: form.source_url.trim() || null,
    };
    setBusy(true);
    setError('');
    try {
      const saved = editing ? await api.updateNews(initial.id, payload) : await api.createNews(payload);
      await onSaved(saved, editing);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const important = form.importance === 'important';

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      size="lg"
      title={editing ? 'Редагувати статтю' : 'Нова стаття'}
      subtitle="Її побачать усі ФОП і спеціалісти платформи"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Скасувати</Button>
          <Button variant="primary" type="submit" form="news-editor-form" loading={busy}>
            {editing ? 'Зберегти зміни' : 'Опублікувати'}
          </Button>
        </>
      }
    >
      <form id="news-editor-form" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="news-title">Заголовок</Label>
          <Input id="news-title" value={form.title} onChange={set('title')} maxLength={200} placeholder="Напр. Зміни у ставці єдиного внеску з 1 січня" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="news-category">Категорія</Label>
            <Select id="news-category" value={form.category} onChange={set('category')}>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="news-effective" hint="необов'язково">Набирає чинності</Label>
            <Input id="news-effective" type="date" value={form.effective_date} onChange={set('effective_date')} />
          </div>
        </div>
        <div>
          <Label htmlFor="news-body" hint={`${form.body.length}/${BODY_MAX}`}>Текст</Label>
          <Textarea
            id="news-body"
            rows={9}
            value={form.body}
            onChange={set('body')}
            maxLength={BODY_MAX}
            placeholder="Що змінилося, кого це стосується, що робити ФОПу. Абзаци розділяйте порожнім рядком."
          />
        </div>
        <div>
          <Label htmlFor="news-source" hint="закон, наказ чи роз'яснення, необов'язково">Посилання на джерело</Label>
          <Input id="news-source" inputMode="url" value={form.source_url} onChange={set('source_url')} maxLength={1000} placeholder="https://zakon.rada.gov.ua/..." />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600"
            checked={important}
            onChange={(e) => setForm((f) => ({ ...f, importance: e.target.checked ? 'important' : 'normal' }))}
          />
          <span className="text-[13px] leading-5 text-slate-700">
            <span className="font-medium text-slate-900">Важливе: показати спливаючим вікном</span>
            <span className="block text-slate-600">
              Усі користувачі побачать це вікно під час входу, доки не натиснуть «Прочитано». Використовуйте для
              справді важливих змін у законах. Ліміт: 3 такі повідомлення на добу.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}
