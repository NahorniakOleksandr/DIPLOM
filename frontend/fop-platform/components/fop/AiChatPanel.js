'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Icon, Spinner, cx } from '@/components/ui';
import Markdown from './Markdown';

const SUGGESTIONS = [
  'Який ліміт доходу для моєї групи?',
  'Коли сплачувати єдиний податок?',
  'Що з ЄСВ за себе?',
  'Який розмір військового збору?',
];

function profileChip(profile) {
  if (!profile?.tax_group) return null;
  const parts = [`Група ${profile.tax_group}`];
  if (profile.tax_rate != null) parts.push(`${Number(profile.tax_rate)}%`);
  if (profile.kveds?.length) {
    const shown = profile.kveds.slice(0, 2).join(', ');
    parts.push(`КВЕД ${shown}${profile.kveds.length > 2 ? ` +${profile.kveds.length - 2}` : ''}`);
  }
  return parts.join(' • ');
}

export default function AiChatPanel({ chat, profile, variant = 'compact', onEscalate, onOpenProfile }) {
  const [draft, setDraft] = useState('');
  const scroller = useRef(null);
  const { messages, sending, error, conversationId } = chat;
  const full = variant === 'full';
  const chip = profileChip(profile);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending]);

  async function submit(e) {
    e?.preventDefault();
    const text = draft;
    if (text.trim().length < 3 || sending) return;
    setDraft('');
    const ok = await chat.send(text);
    if (!ok) setDraft((d) => d || text); // повернути текст у поле, якщо відправка не вдалась
  }

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Icon name="sparkle" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">ШІ-помічник з податків і права</h2>
            <p className="text-xs text-slate-500">Пояснюємо складне простими словами</p>
          </div>
        </div>
        {chip ? (
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600" title="Ці параметри передаються помічнику з вашого профілю">{chip}</span>
        ) : (
          <button type="button" onClick={onOpenProfile} className="rounded-md bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100">
            Додайте профіль для точніших відповідей
          </button>
        )}
      </div>

      <div ref={scroller} className={cx('space-y-4 overflow-y-auto px-5 py-4', full ? 'h-[min(58vh,540px)]' : 'h-[300px]')} aria-live="polite">
        {messages.length === 0 && !sending && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-slate-700">Запитайте про податки, звітність чи законодавство</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
              Відповідаю за статтями бази законів і завжди показую джерело. Якщо відповіді немає в базі — прямо про це скажу.
            </p>
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex flex-col items-end gap-1">
              <div className="max-w-[88%] rounded-xl bg-blue-50 px-3.5 py-2.5 text-[13px] leading-5 text-slate-800">{m.content}</div>
              {m.failed && (
                <p className="text-[11px] text-red-600">
                  Не надіслано.{' '}
                  <button type="button" onClick={() => chat.retry(m.id)} className="font-medium underline">Повторити</button>
                </p>
              )}
            </div>
          ) : (
            <div key={m.id}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">ШІ-помічник</p>
              <div className="rounded-xl bg-slate-50 px-4 py-3.5">
                <Markdown text={m.content} />
                {m.found && m.source_url && (
                  <a href={m.source_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                    Відкрити офіційне джерело <Icon name="external" className="h-3 w-3" />
                  </a>
                )}
                {m.found === false && (
                  <p className="mt-2 text-[11px] text-slate-400">У базі законів немає відповіді на це питання.</p>
                )}
              </div>
              {onEscalate && conversationId && (m.id === lastAssistantId || m.found === false) && (
                <Button variant={m.found === false ? 'primary' : 'soft'} size="sm" className="mt-2" onClick={() => onEscalate(conversationId)}>
                  Передати питання фахівцю <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ),
        )}

        {sending && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">ШІ-помічник</p>
            <div className="inline-flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-500">
              <Spinner className="h-3.5 w-3.5" /> Шукаю відповідь у базі законів…
            </div>
          </div>
        )}
      </div>

      {error && <div className="px-5 pb-3"><Alert>{error}</Alert></div>}

      <div className="border-t border-slate-100 px-5 py-3.5">
        <div className="mb-3 flex flex-wrap gap-2">
          {(full ? SUGGESTIONS : SUGGESTIONS.slice(0, 3)).map((s) => (
            <button
              key={s}
              type="button"
              disabled={sending}
              onClick={() => chat.send(s)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            placeholder="Запитайте про податки, звітність або законодавство…"
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 text-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            aria-label="Ваше питання до ШІ-помічника"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length < 3}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:bg-blue-300"
            aria-label="Надіслати"
          >
            {sending ? <Spinner className="h-4 w-4" /> : <Icon name="arrowUp" className="h-4 w-4" strokeWidth={2.2} />}
          </button>
        </form>
      </div>
    </Card>
  );
}
