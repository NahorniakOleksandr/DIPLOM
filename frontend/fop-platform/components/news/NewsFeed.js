'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, EmptyState, Icon, Input, Select, Skeleton, cx } from '@/components/ui';
import NewsCard from '@/components/news/NewsCard';
import NewsEditor from '@/components/news/NewsEditor';
import SourcesPanel from '@/components/news/SourcesPanel';
import { CATEGORY_OPTIONS, SCOPES } from '@/components/news/newsMeta';

const PAGE = 20;
const SEARCH_DELAY_MS = 350;

/**
 * Стрічка новин (ФОП і спеціаліст). canWrite — спеціаліст: може писати статті, бачить «Мої статті» й стан джерел.
 * onUnreadChange(counts) — повідомляє сторінку про нові лічильники (бейдж вкладки).
 */
export default function NewsFeed({ canWrite = false, onUnreadChange }) {
  const [scope, setScope] = useState('all'); // all | article | official | mine
  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const [list, setList] = useState({ items: [], loading: true, loadingMore: false, error: '', more: false });
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({}); // id → { loading, error, detail }
  const [editor, setEditor] = useState({ open: false, initial: null });
  const [notice, setNotice] = useState('');
  const [busyAll, setBusyAll] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [query]);

  const params = useCallback(
    (offset) => ({
      kind: scope === 'article' || scope === 'official' ? scope : undefined,
      mine: scope === 'mine',
      category: category || undefined,
      unreadOnly,
      q: debounced || undefined,
      limit: PAGE,
      offset,
    }),
    [scope, category, unreadOnly, debounced],
  );

  const load = useCallback(async () => {
    const mySeq = ++seq.current; // відповідь застарілого запиту ігноруємо
    setList((l) => ({ ...l, loading: true, error: '' }));
    try {
      const items = await api.listNews(params(0));
      if (mySeq !== seq.current) return;
      setList({ items, loading: false, loadingMore: false, error: '', more: items.length === PAGE });
    } catch (e) {
      if (mySeq !== seq.current) return;
      setList((l) => ({ ...l, loading: false, error: errorText(e) }));
    }
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    const mySeq = seq.current;
    setList((l) => ({ ...l, loadingMore: true }));
    try {
      const items = await api.listNews(params(list.items.length));
      if (mySeq !== seq.current) return;
      setList((l) => {
        const known = new Set(l.items.map((i) => i.id));
        return { ...l, items: [...l.items, ...items.filter((i) => !known.has(i.id))], loadingMore: false, more: items.length === PAGE };
      });
    } catch (e) {
      setList((l) => ({ ...l, loadingMore: false, error: errorText(e) }));
    }
  }

  const patchItem = (id, patch) =>
    setList((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  async function toggle(item) {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    let detail = details[item.id]?.detail;
    if (!detail) {
      setDetails((d) => ({ ...d, [item.id]: { loading: true, error: '', detail: null } }));
      try {
        detail = await api.getNews(item.id);
        setDetails((d) => ({ ...d, [item.id]: { loading: false, error: '', detail } }));
      } catch (e) {
        setDetails((d) => ({ ...d, [item.id]: { loading: false, error: errorText(e), detail: null } }));
        return;
      }
    }
    if (!item.is_read) {
      try {
        const counts = await api.markNewsRead(item.id);
        patchItem(item.id, { is_read: true });
        onUnreadChange?.(counts);
      } catch {
        /* позначку не збережено — лишиться непрочитаною, повторимо при наступному відкритті */
      }
    }
  }

  async function readAll() {
    setBusyAll(true);
    try {
      const counts = await api.markAllNewsRead();
      onUnreadChange?.(counts);
      setNotice('Усі свіжі новини позначено прочитаними.');
      await load();
    } catch (e) {
      setList((l) => ({ ...l, error: errorText(e) }));
    } finally {
      setBusyAll(false);
    }
  }

  async function remove(item) {
    await api.deleteNews(item.id);
    setExpandedId(null);
    setNotice('Статтю видалено.');
    await load();
    onUnreadChange && api.getNewsUnread().then(onUnreadChange).catch(() => {});
  }

  async function onSaved(saved, wasEditing) {
    setEditor({ open: false, initial: null });
    setDetails((d) => ({ ...d, [saved.id]: { loading: false, error: '', detail: saved } }));
    setNotice(
      wasEditing
        ? 'Зміни збережено.'
        : saved.importance === 'important'
          ? 'Статтю опубліковано. Іншим користувачам вона спливе у вікні, доки вони її не підтвердять.'
          : 'Статтю опубліковано.',
    );
    setExpandedId(saved.id);
    await load();
  }

  const scopes = canWrite ? [...SCOPES, { id: 'mine', label: 'Мої статті' }] : SCOPES;
  const filtered = scope !== 'all' || category || unreadOnly || debounced;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Новини</h1>
          <p className="mt-1 text-sm text-slate-500">
            Зміни в законодавстві, податках і звітності: статті спеціалістів та офіційні джерела.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" loading={busyAll} onClick={readAll}>
            <Icon name="check" className="h-3.5 w-3.5" /> Позначити все прочитаним
          </Button>
          {canWrite && (
            <Button size="sm" variant="primary" onClick={() => setEditor({ open: true, initial: null })}>
              <Icon name="plus" className="h-3.5 w-3.5" /> Написати статтю
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <Alert
          tone="green"
          action={<button type="button" onClick={() => setNotice('')} className="shrink-0 text-xs font-medium underline">Закрити</button>}
        >
          {notice}
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Джерело новин">
          {scopes.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={scope === s.id}
              onClick={() => setScope(s.id)}
              className={cx(
                'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                scope === s.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="w-full sm:w-52">
          <Select aria-label="Категорія" value={category} onChange={(e) => setCategory(e.target.value)} className="h-9">
            <option value="">Усі категорії</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </Select>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-slate-700">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Лише непрочитані
        </label>
        <div className="w-full sm:ml-auto sm:w-56">
          <Input
            aria-label="Пошук за заголовком"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук…"
            maxLength={100}
            className="h-9"
          />
        </div>
      </div>

      {list.error && (
        <Alert action={<button type="button" onClick={load} className="shrink-0 text-xs font-medium underline">Повторити</button>}>
          {list.error}
        </Alert>
      )}

      {list.loading && list.items.length === 0 ? (
        <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      ) : list.items.length === 0 && !list.error ? (
        <EmptyState
          title={filtered ? 'Нічого не знайдено' : 'Новин поки немає'}
          action={filtered ? (
            <Button size="sm" variant="secondary" onClick={() => { setScope('all'); setCategory(''); setUnreadOnly(false); setQuery(''); }}>
              Скинути фільтри
            </Button>
          ) : undefined}
        >
          {filtered
            ? 'Змініть фільтри або пошуковий запит.'
            : canWrite
              ? 'Напишіть першу статтю або налаштуйте офіційні джерела нижче.'
              : 'Тут з’являтимуться статті спеціалістів та новини про зміни в законах.'}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {list.items.map((item) => (
            <NewsCard
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              state={details[item.id]}
              onToggle={toggle}
              onEdit={(detail) => setEditor({ open: true, initial: detail })}
              onDelete={remove}
            />
          ))}
          {list.more && (
            <div className="flex justify-center pt-1">
              <Button variant="secondary" loading={list.loadingMore} onClick={loadMore}>Показати ще</Button>
            </div>
          )}
        </div>
      )}

      {canWrite && <SourcesPanel onSynced={load} />}

      <NewsEditor
        open={editor.open}
        initial={editor.initial}
        onClose={() => setEditor({ open: false, initial: null })}
        onSaved={onSaved}
      />
    </div>
  );
}
