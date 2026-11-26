'use client';

import { Alert, Button, Card, EmptyState, Icon, Skeleton, cx } from '@/components/ui';
import { firstName, plural } from '@/lib/format';
import ConsultationRow from '@/components/specialist/ConsultationRow';
import Timeline from '@/components/specialist/Timeline';

const STAT_TONES = {
  slate: 'text-slate-900',
  amber: 'text-amber-600',
  blue: 'text-blue-700',
  green: 'text-emerald-600',
};

function Stat({ label, value, hint, tone = 'slate', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(
        'rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        onClick && 'transition-colors hover:border-blue-200 hover:bg-blue-50/30',
      )}
    >
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cx('mt-1 text-2xl font-semibold tabular-nums', STAT_TONES[tone])}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Tag>
  );
}

function greeting() {
  const hour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Kyiv' }));
  if (hour < 5) return 'Доброї ночі';
  if (hour < 12) return 'Доброго ранку';
  if (hour < 18) return 'Доброго дня';
  return 'Доброго вечора';
}

/** Чек-лист налаштування: послуги й розклад потрібні, щоб клієнти могли записатися. */
function SetupCard({ setup, goTab }) {
  const steps = [
    { done: setup.has_services, label: 'Додайте хоча б одну послугу з ціною', tab: 'profile', cta: 'До послуг', required: true },
    { done: setup.has_schedule, label: 'Налаштуйте робочі години в розкладі', tab: 'schedule', cta: 'До розкладу', required: true },
    { done: setup.has_profile_text, label: 'Заповніть заголовок і опис у профілі', tab: 'profile', cta: 'До профілю', required: false },
  ];
  const done = steps.filter((s) => s.done).length;
  const blocking = steps.some((s) => s.required && !s.done);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {blocking ? 'Налаштуйте кабінет — і клієнти зможуть записатися' : 'Профіль майже готовий'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Виконано {done} із {steps.length}</p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-slate-100">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3 py-2.5">
            <span
              className={cx(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                s.done ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 text-transparent',
              )}
            >
              <Icon name="check" className="h-3 w-3" strokeWidth={2.5} />
            </span>
            <span className={cx('flex-1 text-[13px]', s.done ? 'text-slate-400 line-through' : 'text-slate-800')}>{s.label}</span>
            {!s.done && (
              <Button size="sm" variant="soft" onClick={() => goTab(s.tab)}>{s.cta}</Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function OverviewTab({ user, dashboard, requests, upcoming, error, onReload, actions, onOpen, onChat, goTab }) {
  const loading = !dashboard && !error;
  const setup = dashboard?.setup;
  const allSetUp = setup && setup.has_services && setup.has_schedule && setup.has_profile_text;
  const nextItems = (upcoming || []).slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {greeting()}{user?.full_name ? `, ${firstName(user.full_name)}` : ''}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Усі дати й години — за київським часом.</p>
      </div>

      {error && (
        <Alert action={<button type="button" onClick={onReload} className="shrink-0 text-xs font-medium underline">Спробувати ще раз</button>}>
          {error}
        </Alert>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {setup && !allSetUp && <SetupCard setup={setup} goTab={goTab} />}

      {dashboard?.to_complete_count > 0 && (
        <Alert
          tone="amber"
          action={
            <button type="button" onClick={() => goTab('consultations')} className="shrink-0 text-xs font-medium underline">
              Показати
            </button>
          }
        >
          {plural(dashboard.to_complete_count, 'консультація потребує', 'консультації потребують', 'консультацій потребують')} завершення:
          додайте підсумок для клієнта й закрийте її.
        </Alert>
      )}

      {dashboard && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Нові заявки"
            value={dashboard.pending_count}
            hint={dashboard.pending_count ? 'Чекають вашого рішення' : 'Усі опрацьовано'}
            tone={dashboard.pending_count ? 'amber' : 'slate'}
            onClick={() => goTab('requests')}
          />
          <Stat label="Сьогодні" value={dashboard.today_count} hint={dashboard.today_count ? 'консультацій за графіком' : 'Вільний день'} tone="blue" onClick={() => goTab('consultations')} />
          <Stat label="Майбутні" value={dashboard.upcoming_count} hint="Підтверджені й ще не розпочаті" onClick={() => goTab('consultations')} />
          <Stat
            label="Проведено"
            value={dashboard.completed_count}
            hint={`${plural(dashboard.clients_count, 'клієнт', 'клієнти', 'клієнтів')} загалом`}
            tone="green"
          />
        </div>
      )}

      {dashboard && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="ov-requests">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="ov-requests" className="text-sm font-semibold text-slate-900">Нові заявки</h2>
              {requests?.length > 3 && (
                <button type="button" onClick={() => goTab('requests')} className="text-xs font-medium text-blue-600 hover:underline">
                  Усі заявки ({requests.length})
                </button>
              )}
            </div>
            {requests?.length ? (
              <div className="space-y-3">
                {requests.slice(0, 3).map((item) => (
                  <ConsultationRow key={item.id} item={item} actions={actions} onOpen={onOpen} onChat={onChat} highlight />
                ))}
              </div>
            ) : (
              <EmptyState title="Нових заявок немає">Коли клієнт запишеться, заявка з’явиться тут.</EmptyState>
            )}
          </section>

          <section aria-labelledby="ov-next">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="ov-next" className="text-sm font-semibold text-slate-900">Найближчі консультації</h2>
              {upcoming?.length > nextItems.length && (
                <button type="button" onClick={() => goTab('consultations')} className="text-xs font-medium text-blue-600 hover:underline">
                  Усі ({upcoming.length})
                </button>
              )}
            </div>
            <Timeline
              items={nextItems}
              onOpen={onOpen}
              onComplete={actions.complete}
              emptyTitle="Підтверджених консультацій поки немає"
              emptyText="Підтвердьте заявку — вона з’явиться в розкладі зустрічей."
            />
          </section>
        </div>
      )}
    </div>
  );
}
