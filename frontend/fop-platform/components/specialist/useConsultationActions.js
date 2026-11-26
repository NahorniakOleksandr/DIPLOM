'use client';

import { useCallback, useState } from 'react';
import api from '@/lib/api';
import { CompleteDialog, ConfirmDialog, RejectDialog } from '@/components/specialist/ActionDialogs';

/**
 * Дії над консультацією (підтвердити / відхилити або скасувати / завершити) з діалогами.
 * Хук викликається один раз на сторінці; його `dialogs` рендеряться там же, а confirm/reject/complete
 * передаються у списки й картку. Кожна дія — реальний PATCH /expert/bookings/{id}/status.
 * onDone(message) викликається після успіху: сторінка оновлює списки й показує повідомлення.
 */
export default function useConsultationActions({ onDone }) {
  const [dialog, setDialog] = useState(null); // { type, item }
  const close = useCallback(() => setDialog(null), []);

  const confirm = useCallback((item) => setDialog({ type: 'confirm', item }), []);
  const reject = useCallback((item) => setDialog({ type: 'reject', item }), []);
  const complete = useCallback((item) => setDialog({ type: 'complete', item }), []);

  const item = dialog?.item;
  const dialogs = (
    <>
      {dialog?.type === 'confirm' && (
        <ConfirmDialog
          item={item}
          onClose={close}
          onSubmit={async (meetingUrl) => {
            await api.setBookingStatus(item.id, { status: 'confirmed', meetingUrl });
            await onDone(`Заявку підтверджено. ${item.client_name} побачить зміну статусу у своєму кабінеті.`);
          }}
        />
      )}
      {dialog?.type === 'reject' && (
        <RejectDialog
          item={item}
          onClose={close}
          onSubmit={async (reason) => {
            await api.setBookingStatus(item.id, { status: 'rejected', reason });
            await onDone(item.status === 'pending' ? 'Заявку відхилено, час знову вільний.' : 'Консультацію скасовано, час знову вільний.');
          }}
        />
      )}
      {dialog?.type === 'complete' && (
        <CompleteDialog
          item={item}
          onClose={close}
          onSubmit={async (summary) => {
            await api.setBookingStatus(item.id, { status: 'completed', summary });
            await onDone(summary ? 'Консультацію завершено. Клієнт бачитиме ваш підсумок.' : 'Консультацію завершено.');
          }}
        />
      )}
    </>
  );

  return { confirm, reject, complete, dialogs };
}
