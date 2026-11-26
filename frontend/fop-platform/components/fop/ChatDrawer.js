'use client';

import ChatThread from '@/components/ChatThread';
import { Modal } from '@/components/ui';

/** Переписка ФОПа зі спеціалістом у модальному вікні. Сама переписка — у спільному ChatThread. */
export default function ChatDrawer({ peer, meId, onClose }) {
  return (
    <Modal open={Boolean(peer)} onClose={onClose} title={`Чат: ${peer?.name || ''}`} subtitle="Повідомлення бачить лише ваш фахівець" size="md">
      <ChatThread peer={peer} meId={meId} className="h-[52vh]" />
    </Modal>
  );
}
