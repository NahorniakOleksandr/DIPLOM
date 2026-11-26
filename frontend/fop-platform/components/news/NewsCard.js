'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Icon, Skeleton, cx } from '@/components/ui';
import { formatDueDate, kyivDate } from '@/lib/format';
import { CATEGORY_TONE, bylineOf } from '@/components/news/newsMeta';

/**
 * Картка новини в стрічці. Розгортається по кліку; повний текст приходить окремим запитом (state.detail).
 * state: { loading, error, detail } для розгорнутої картки.
 */
export default function NewsCard({ item, expanded, state, onToggle, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const important = item.importance === 'important';
  const official = item.kind === 'official';

  async function remove() {
    setDeleting(true);
    setDeleteError('');
    try {
      await onDelete(item);
    } catch (e) {
      setDeleteError(e.message || 'Не вдалося видалити');
      setDeleting(false);
    }
  }

  return (
    <article
      className={cx(
        'rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        important ? 'border-amber-300' : 'border-slate-200',
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(item)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 text-left"
      >
        <span
          className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', item.is_read ? 'bg-transparent' : 'bg-blue-600')}
          title={item.is_read ? undefined : 'Непрочитане'}
          aria-label={item.is_read ? undefined : 'Непрочитане'}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            {important && (
              <Badge tone="amber">
                <Icon name="alert" className="mr-1 h-3 w-3" /> Важливо
              </Badge>
            )}
            <Badge tone={CATEGORY_TONE[item.category] || 'slate'}>{item.category_label}</Badge>
            {official && <Badge tone="slate">Офіційне джерело</Badge>}
          </span>
          <span className="mt-1.5 block text-[15px] font-semibold leading-snug text-slate-900">{item.title}</span>
          <span className="mt-1 block text-xs text-slate-500">
            {bylineOf(item)} · {kyivDate(item.published_at)}
            {item.edited && ' · відредаговано'}
          </span>
          {!expanded && item.summary && (
            <span className="mt-2 line-clamp-2 block text-[13px] leading-5 text-slate-600">{item.summary}</span>
          )}
        </span>
        <Icon
          name="chevronDown"
          className={cx('mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform', expanded && 'rotate-180')}
        />
      </button>

      {expanded && (
        <div className="mt-3 border-t border-slate-100 pt-3 pl-5">
          {state?.loading && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          {state?.error && <Alert>{state.error}</Alert>}
          {state?.detail && (
            <>
              {item.effective_date && (
                <p className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                  <Icon name="calendar" className="h-3.5 w-3.5" /> Набирає чинності: {formatDueDate(item.effective_date)}
                </p>
              )}
              <p className="whitespace-pre-line break-words text-sm leading-6 text-slate-800">{state.detail.body}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {item.source_url && (
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-blue-700 hover:underline"
                  >
                    <Icon name="external" className="h-3.5 w-3.5" />
                    {official ? 'Читати на сайті джерела' : 'Джерело'}
                  </a>
                )}
                <span className="text-[11px] text-slate-400">
                  {official
                    ? 'Витяг із офіційної стрічки. Перед застосуванням звіряйте з повним текстом документа.'
                    : 'Матеріал підготував спеціаліст платформи; це не офіційний документ і не заміна консультації.'}
                </span>
              </div>

              {item.is_mine && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  {!confirmDelete ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => onEdit(state.detail)}>
                        <Icon name="pencil" className="h-3.5 w-3.5" /> Редагувати
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                        <Icon name="trash" className="h-3.5 w-3.5" /> Видалити
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-[13px] text-slate-700">Видалити статтю назавжди?</span>
                      <Button size="sm" variant="danger" loading={deleting} onClick={remove}>Так, видалити</Button>
                      <Button size="sm" variant="secondary" disabled={deleting} onClick={() => setConfirmDelete(false)}>
                        Скасувати
                      </Button>
                    </>
                  )}
                  {deleteError && <span className="text-xs text-red-600">{deleteError}</span>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
