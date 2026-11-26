'use client';

import { useEffect, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, Input, Label, Modal, Spinner, Textarea } from '@/components/ui';
import { kyivSlotLabel } from '@/lib/format';

const URL_RE = /^https?:\/\/\S+$/i;

/** Спільна поведінка діалогів: виконує дію, показує справжню помилку бекенду, закриває діалог лише після успіху. */
function useAction(onSubmit, onClose) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(...args) {
    setBusy(true);
    setError('');
    try {
      await onSubmit(...args);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

function Footer({ busy, onClose, submitLabel, onSubmit, disabled, tone = 'primary' }) {
  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Скасувати</Button>
      <Button variant={tone} loading={busy} disabled={disabled} onClick={onSubmit}>{submitLabel}</Button>
    </>
  );
}

// ---------- Підтвердження ----------
export function ConfirmDialog({ item, onClose, onSubmit }) {
  const [url, setUrl] = useState(item.meeting_url || '');
  const { busy, error, setError, run } = useAction(onSubmit, onClose);

  function submit() {
    const value = url.trim();
    if (value && !URL_RE.test(value)) {
      setError('Посилання має починатися з http:// або https://');
      return;
    }
    run(value);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Підтвердити консультацію"
      subtitle={`${item.client_name} · ${kyivSlotLabel(item.slot_datetime, item.slot_end)}`}
      footer={<Footer busy={busy} onClose={onClose} submitLabel="Підтвердити" onSubmit={submit} />}
    >
      <Label htmlFor="meeting-url" hint="(необов'язково)">Посилання на зустріч</Label>
      <Input
        id="meeting-url"
        type="url"
        inputMode="url"
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="https://meet.google.com/…"
        maxLength={500}
      />
      <p className="mt-2 text-xs leading-5 text-slate-500">
        Клієнт побачить посилання у своєму кабінеті. Додати чи змінити його можна й пізніше в картці консультації.
      </p>
      {error && <Alert className="mt-3">{error}</Alert>}
    </Modal>
  );
}

// ---------- Відхилення / скасування ----------
const REASONS_PENDING = ['Немає вільного часу', 'Питання поза моєю спеціалізацією', 'Прошу обрати інший час'];
const REASONS_CONFIRMED = ['Захворів(ла)', 'Непередбачені обставини', 'Потрібно перенести консультацію'];

export function RejectDialog({ item, onClose, onSubmit }) {
  const cancelling = item.status !== 'pending'; // підтверджену вже обіцяно клієнту — причина обов'язкова
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(onSubmit, onClose);
  const quick = cancelling ? REASONS_CONFIRMED : REASONS_PENDING;

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={cancelling ? 'Скасувати консультацію' : 'Відхилити заявку'}
      subtitle={`${item.client_name} · ${kyivSlotLabel(item.slot_datetime, item.slot_end)}`}
      footer={
        <Footer
          busy={busy}
          onClose={onClose}
          tone="danger"
          submitLabel={cancelling ? 'Скасувати консультацію' : 'Відхилити'}
          disabled={cancelling && !reason.trim()}
          onSubmit={() => run(reason.trim())}
        />
      }
    >
      <Label htmlFor="reject-reason" hint={cancelling ? '(обов’язково)' : '(необов’язково)'}>Причина</Label>
      <Textarea
        id="reject-reason"
        rows={3}
        autoFocus
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Клієнт побачить цей текст"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {quick.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => setReason(text)}
            className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
          >
            {text}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        {cancelling ? 'Час стане вільним для інших клієнтів. Клієнт одразу побачить, що консультацію скасовано.' : 'Час стане вільним для інших клієнтів.'}
      </p>
      {error && <Alert className="mt-3">{error}</Alert>}
    </Modal>
  );
}

// ---------- Завершення ----------
export function CompleteDialog({ item, onClose, onSubmit }) {
  // Чернетка підсумку може вже існувати (її видно лише у картці) — підвантажуємо, щоб не затерти
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(Boolean(item.has_summary));
  const { busy, error, setError, run } = useAction(onSubmit, onClose);

  useEffect(() => {
    if (!item.has_summary) return undefined;
    let alive = true;
    api
      .getExpertConsultation(item.id)
      .then((d) => alive && setSummary(d.expert_summary || ''))
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [item.id, item.has_summary, setError]);

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Завершити консультацію"
      subtitle={`${item.client_name} · ${kyivSlotLabel(item.slot_datetime, item.slot_end)}`}
      footer={<Footer busy={busy} disabled={loading} onClose={onClose} submitLabel="Завершити" onSubmit={() => run(summary.trim())} />}
    >
      <Label htmlFor="complete-summary" hint="(необов’язково)">Підсумок для клієнта</Label>
      {loading ? (
        <div className="flex justify-center py-6 text-slate-400"><Spinner /></div>
      ) : (
        <Textarea
          id="complete-summary"
          rows={6}
          autoFocus
          maxLength={5000}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Що обговорили, що рекомендуєте зробити і до яких строків…"
        />
      )}
      <p className="mt-2 text-xs leading-5 text-slate-500">
        Клієнт побачить цей підсумок у своєму кабінеті після завершення. Ваші приватні нотатки залишаються лише у вас.
      </p>
      {error && <Alert className="mt-3">{error}</Alert>}
    </Modal>
  );
}
