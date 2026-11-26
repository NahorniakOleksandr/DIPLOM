'use client';

import { Alert, Button, EmptyState, Skeleton } from '@/components/ui';
import { plural } from '@/lib/format';
import ConsultationRow from '@/components/specialist/ConsultationRow';

/** Нові заявки (pending): підтвердити, відхилити або відкрити картку клієнта. */
export default function RequestsTab({ requests, error, onReload, actions, onOpen, onChat, setup, goTab }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Заявки на консультації</h1>
        <p className="mt-1 text-sm text-slate-500">
          Перегляньте параметри клієнта й контекст від ШІ, перш ніж підтвердити час.
        </p>
      </div>

      {error && (
        <Alert action={<button type="button" onClick={onReload} className="shrink-0 text-xs font-medium underline">Спробувати ще раз</button>}>
          {error}
        </Alert>
      )}

      {!requests && !error && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      )}

      {requests && requests.length === 0 && (
        <EmptyState
          title="Нових заявок немає"
          action={
            setup && !(setup.has_schedule && setup.has_services) ? (
              <Button size="sm" variant="soft" onClick={() => goTab(setup.has_services ? 'schedule' : 'profile')}>
                Завершити налаштування
              </Button>
            ) : null
          }
        >
          {setup && !(setup.has_schedule && setup.has_services)
            ? 'Клієнти не зможуть записатися, поки немає послуг і робочих годин.'
            : 'Коли клієнт запишеться, заявка з’явиться тут.'}
        </EmptyState>
      )}

      {requests && requests.length > 0 && (
        <>
          <p className="text-xs font-medium text-slate-500">
            {plural(requests.length, 'заявка очікує', 'заявки очікують', 'заявок очікують')} рішення
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {requests.map((item) => (
              <ConsultationRow key={item.id} item={item} actions={actions} onOpen={onOpen} onChat={onChat} highlight={!item.is_past} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
