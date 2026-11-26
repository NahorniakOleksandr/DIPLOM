'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Avatar, Badge, Button, EmptyState, Icon, Input, Skeleton, Textarea, cx } from '@/components/ui';
import { kyivDate, kyivSlotLabel, money, parseUtc } from '@/lib/format';
import { ClientParams, EXPERT_STATUS, StatusBadge } from '@/components/specialist/parts';

const URL_RE = /^https?:\/\/\S+$/i;
const NOTES_MAX = 5000;

function Section({ icon, title, hint, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start gap-2">
        <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div>
          <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
          {hint && <p className="mt-0.5 text-xs leading-5 text-slate-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function SaveRow({ dirty, saving, saved, onSave, error, disabled }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-3">
      <Button size="sm" variant="primary" disabled={!dirty || disabled} loading={saving} onClick={onSave}>
        Зберегти
      </Button>
      {saved && !dirty && !saving && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
          <Icon name="check" className="h-3.5 w-3.5" /> Збережено
        </span>
      )}
      {dirty && !saving && <span className="text-xs text-amber-600">Є незбережені зміни</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

/**
 * Картка консультації (виїзна панель справа): клієнт і його параметри ФОП, «Контекст від ШІ», історія з клієнтом,
 * приватні нотатки та підсумок для клієнта. Усе читається й зберігається реальними запитами
 * GET/PATCH /expert/consultations/{id}. Чернетки, які ви ще не зберегли, не затираються оновленням даних.
 */
export default function ConsultationDrawer({ id, version, actions, onClose, onSaved, onChat }) {
  const [detail, setDetail] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [drafts, setDrafts] = useState({ meeting: '', notes: '', summary: '' });
  const [saving, setSaving] = useState({});
  const [saved, setSaved] = useState({});
  const [fieldError, setFieldError] = useState({});
  const [pendingExit, setPendingExit] = useState(null); // дія, що чекає підтвердження виходу без збереження
  const server = useRef({ meeting: '', notes: '', summary: '' }); // останні значення з сервера

  const dirty = {
    meeting: drafts.meeting.trim() !== server.current.meeting,
    notes: drafts.notes.trim() !== server.current.notes,
    summary: drafts.summary.trim() !== server.current.summary,
  };
  const anyDirty = dirty.meeting || dirty.notes || dirty.summary;

  // Застосовує відповідь сервера: незмінені поля оновлюються, ті, що редагуються, — лишаються
  const apply = useCallback((d) => {
    // prev фіксуємо ДО присвоєння: оновлювач стану виконається пізніше, коли server.current уже зміниться
    const prev = server.current;
    const next = { meeting: d.meeting_url || '', notes: d.expert_notes || '', summary: d.expert_summary || '' };
    server.current = next;
    setDrafts((cur) => ({
      meeting: cur.meeting.trim() === prev.meeting ? next.meeting : cur.meeting,
      notes: cur.notes.trim() === prev.notes ? next.notes : cur.notes,
      summary: cur.summary.trim() === prev.summary ? next.summary : cur.summary,
    }));
    setDetail(d);
  }, []);

  // Завантаження при відкритті й після дій (version)
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    api
      .getExpertConsultation(id)
      .then((d) => {
        if (!alive) return;
        setLoadError('');
        apply(d);
      })
      .catch((e) => alive && setLoadError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [id, version, apply]);

  // Нова консультація — чистий стан
  useEffect(() => {
    setDetail(null);
    setLoadError('');
    setSaved({});
    setFieldError({});
    setPendingExit(null);
    server.current = { meeting: '', notes: '', summary: '' };
    setDrafts({ meeting: '', notes: '', summary: '' });
  }, [id]);

  // Вихід із картки (закриття, перехід до чату) із попередженням про незбережені зміни
  const guard = useCallback(
    (fn) => {
      if (anyDirty) setPendingExit(() => fn);
      else fn();
    },
    [anyDirty],
  );
  const requestClose = useCallback(() => guard(onClose), [guard, onClose]);

  // Esc закриває панель, але не тоді, коли поверх неї відкрито діалог дії
  useEffect(() => {
    if (!id) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]:not([data-drawer])')) return;
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [id, requestClose]);

  async function save(field, patch, validate) {
    const problem = validate?.();
    if (problem) {
      setFieldError((e) => ({ ...e, [field]: problem }));
      return;
    }
    setSaving((s) => ({ ...s, [field]: true }));
    setFieldError((e) => ({ ...e, [field]: '' }));
    try {
      const d = await api.updateExpertConsultation(id, patch);
      server.current = {
        meeting: d.meeting_url || '',
        notes: d.expert_notes || '',
        summary: d.expert_summary || '',
      };
      setDrafts({ meeting: server.current.meeting, notes: server.current.notes, summary: server.current.summary });
      setDetail(d);
      setSaved((s) => ({ ...s, [field]: true }));
      onSaved?.();
    } catch (e) {
      setFieldError((er) => ({ ...er, [field]: errorText(e) }));
    } finally {
      setSaving((s) => ({ ...s, [field]: false }));
    }
  }

  const edit = (field) => (e) => {
    setDrafts((d) => ({ ...d, [field]: e.target.value }));
    setSaved((s) => ({ ...s, [field]: false }));
  };

  if (!id) return null;
  const d = detail;
  const cancelled = d && (d.status === 'rejected' || d.status === 'cancelled');

  return (
    <div className="fixed inset-0 z-40 flex justify-end" data-testid="consultation-drawer">
      <div className="absolute inset-0 bg-slate-900/40" onClick={requestClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        data-drawer
        aria-label="Картка консультації"
        className="relative flex h-full w-full max-w-xl flex-col bg-slate-50 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Консультація № {id}</p>
            <h2 className="mt-0.5 truncate text-base font-semibold text-slate-900">{d ? d.service_title : 'Завантаження…'}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {d && <StatusBadge item={d} />}
            <button
              type="button"
              onClick={requestClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Закрити картку"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        </header>

        {pendingExit && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-[13px] text-amber-900" role="alert">
            <p className="font-medium">Є незбережені зміни. Вийти без збереження?</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="danger" onClick={() => pendingExit()}>Вийти без збереження</Button>
              <Button size="sm" variant="secondary" onClick={() => setPendingExit(null)}>Повернутися</Button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loadError && !d && <Alert>{loadError}</Alert>}
          {!d && !loadError && (
            <div className="space-y-4">
              <Skeleton className="h-28" />
              <Skeleton className="h-32" />
              <Skeleton className="h-40" />
            </div>
          )}

          {d && (
            <>
              {loadError && <Alert>{loadError}</Alert>}

              <Section icon="calendar" title="Час і зустріч">
                <p className="text-sm font-semibold text-slate-900">{kyivSlotLabel(d.slot_datetime, d.slot_end)}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {d.service_title} · {money(d.service_price)} грн · київський час
                </p>

                {d.can_edit_meeting ? (
                  <div className="mt-3">
                    <label htmlFor="drawer-meeting" className="mb-1.5 block text-xs font-medium text-slate-700">Посилання на зустріч</label>
                    <div className="flex gap-2">
                      <Input id="drawer-meeting" type="url" inputMode="url" placeholder="https://meet.google.com/…" maxLength={500} value={drafts.meeting} onChange={edit('meeting')} />
                      {server.current.meeting && (
                        <a
                          href={server.current.meeting}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-medium text-blue-700 hover:bg-blue-50"
                        >
                          <Icon name="external" className="h-3.5 w-3.5" /> Відкрити
                        </a>
                      )}
                    </div>
                    <SaveRow
                      dirty={dirty.meeting}
                      saving={saving.meeting}
                      saved={saved.meeting}
                      error={fieldError.meeting}
                      onSave={() =>
                        save('meeting', { meeting_url: drafts.meeting.trim() }, () =>
                          drafts.meeting.trim() && !URL_RE.test(drafts.meeting.trim()) ? 'Посилання має починатися з http:// або https://' : '',
                        )
                      }
                    />
                  </div>
                ) : (
                  d.meeting_url && (
                    <a href={d.meeting_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline">
                      <Icon name="video" className="h-3.5 w-3.5" /> {d.meeting_url}
                    </a>
                  )
                )}

                {d.status === 'rejected' && d.rejection_reason && (
                  <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Причина відхилення: {d.rejection_reason}</p>
                )}
              </Section>

              <Section icon="user" title="Клієнт">
                <div className="flex items-start gap-3">
                  <Avatar name={d.client_name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{d.client_name}</p>
                    <div className="mt-1.5">
                      <ClientParams profile={d.client_profile} maxKveds={6} />
                    </div>
                    {d.client_profile?.updated_at && (
                      <p className="mt-1.5 text-[11px] text-slate-400">Профіль ФОП оновлено {kyivDate(d.client_profile.updated_at)}</p>
                    )}
                  </div>
                  {!cancelled && (
                    <Button size="sm" variant="secondary" onClick={() => guard(() => onChat({ id: d.client_id, name: d.client_name }))}>
                      <Icon name="chat" className="h-3.5 w-3.5" /> Чат
                    </Button>
                  )}
                </div>
              </Section>

              <Section icon="sparkle" title="Контекст від ШІ" hint="Підсумок розмови клієнта з ШІ-помічником. Це довідкова інформація, а не юридичний висновок.">
                {d.ai_summary ? (
                  <div className="rounded-xl bg-blue-50/60 p-3">
                    <p className="whitespace-pre-wrap text-[13px] leading-5 text-slate-800">{d.ai_summary}</p>
                    {d.ai_summary_created_at && (
                      <p className="mt-2 text-[11px] text-slate-500">Передано {kyivDate(d.ai_summary_created_at)}</p>
                    )}
                  </div>
                ) : (
                  <EmptyState title="Клієнт не передавав контекст">
                    Він записався без розмови з ШІ-помічником або не додав її підсумок до заявки.
                  </EmptyState>
                )}
              </Section>

              {d.history.length > 0 && (
                <Section icon="clock" title="Історія з цим клієнтом" hint="Попередні консультації у вас">
                  <ul className="divide-y divide-slate-100">
                    {d.history.map((h) => {
                      const meta = EXPERT_STATUS[h.status] || { label: h.status, tone: 'slate' };
                      return (
                        <li key={h.id} className="py-2.5 first:pt-0 last:pb-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-[13px] font-medium text-slate-800">{h.service_title}</p>
                            <Badge tone={meta.tone} className="shrink-0">{meta.label}</Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">{kyivDate(h.slot_datetime)}</p>
                          {h.summary_preview && <p className="mt-1 text-xs italic leading-5 text-slate-600">«{h.summary_preview}»</p>}
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              <Section icon="lock" title="Приватні нотатки" hint="Бачите лише ви. Клієнт ніколи не побачить цей текст.">
                <Textarea
                  rows={4}
                  maxLength={NOTES_MAX}
                  value={drafts.notes}
                  onChange={edit('notes')}
                  placeholder="Що важливо пам’ятати про клієнта, на що звернути увагу…"
                  aria-label="Приватні нотатки"
                />
                <SaveRow
                  dirty={dirty.notes}
                  saving={saving.notes}
                  saved={saved.notes}
                  error={fieldError.notes}
                  onSave={() => save('notes', { expert_notes: drafts.notes.trim() })}
                />
              </Section>

              <Section
                icon="doc"
                title="Підсумок для клієнта"
                hint={
                  d.status === 'completed'
                    ? 'Клієнт бачить цей підсумок у своєму кабінеті.'
                    : d.can_write_summary
                      ? 'Клієнт побачить підсумок лише після того, як ви завершите консультацію.'
                      : cancelled
                        ? 'Для відхилених і скасованих консультацій підсумок не пишеться.'
                        : 'Підсумок можна написати після підтвердження консультації.'
                }
              >
                <Textarea
                  rows={5}
                  maxLength={NOTES_MAX}
                  value={drafts.summary}
                  onChange={edit('summary')}
                  disabled={!d.can_write_summary}
                  placeholder="Що обговорили, що рекомендуєте зробити і до яких строків…"
                  aria-label="Підсумок для клієнта"
                />
                {d.can_write_summary && (
                  <SaveRow
                    dirty={dirty.summary}
                    saving={saving.summary}
                    saved={saved.summary}
                    error={fieldError.summary}
                    onSave={() => save('summary', { expert_summary: drafts.summary.trim() })}
                  />
                )}
              </Section>

              <p className="px-1 text-[11px] text-slate-400">
                Заявку створено {parseUtc(d.created_at)?.toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' })}
              </p>
            </>
          )}
        </div>

        {d && (d.can_confirm || d.can_reject || d.can_complete) && (
          <footer className={cx('flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3')}>
            {d.can_reject && (
              <Button variant="danger" onClick={() => actions.reject(d)}>
                {d.status === 'pending' ? 'Відхилити заявку' : 'Скасувати консультацію'}
              </Button>
            )}
            {d.can_confirm && (
              <Button variant="primary" onClick={() => actions.confirm(d)}>
                <Icon name="check" className="h-4 w-4" /> Підтвердити
              </Button>
            )}
            {d.can_complete && (
              <Button variant="primary" onClick={() => actions.complete(d)}>
                <Icon name="check" className="h-4 w-4" /> Завершити консультацію
              </Button>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}
