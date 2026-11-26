'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

const POLL_MS = 60000;

/**
 * Лічильники непрочитаних новин для бейджа вкладки. Помилка опитування не показується окремо:
 * бейдж — допоміжний; повні помилки видно у самій стрічці та спливаючому вікні.
 */
export default function useNewsUnread(enabled) {
  const [counts, setCounts] = useState({ unread: 0, important_unread: 0 });

  const refresh = useCallback(async () => {
    try {
      setCounts(await api.getNewsUnread());
    } catch {
      /* залишаємо попереднє значення */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const timer = setInterval(() => !document.hidden && refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  return { counts, setCounts, refresh };
}
