'use client';

import { useCallback, useRef, useState } from 'react';
import api, { errorText } from '@/lib/api';

/**
 * Стан ШІ-чату. Кожна відправка — реальний POST /api/ai/chat; відповідь і історія зберігаються в БД.
 * Якщо бекенд повернув помилку (немає ключа API, ліміт, збій) — показуємо його повідомлення як є.
 */
export default function useAiChat() {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [conversations, setConversations] = useState([]);
  const [listError, setListError] = useState('');
  const counter = useRef(0);

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
      setListError('');
    } catch (e) {
      setListError(errorText(e));
    }
  }, []);

  const send = useCallback(
    async (raw) => {
      const text = (raw || '').trim();
      if (text.length < 3 || sending) return false;
      const localId = `local-${++counter.current}`;
      setMessages((m) => [...m, { id: localId, role: 'user', content: text }]);
      setSending(true);
      setError('');
      try {
        const res = await api.aiChat(text, conversationId);
        setConversationId(res.conversation_id);
        setMessages((m) => [
          ...m.map((x) => (x.id === localId ? { ...x, id: `u-${res.message_id}` } : x)),
          {
            id: `a-${res.message_id}`,
            role: 'assistant',
            content: res.answer,
            found: res.found,
            article_title: res.article_title,
            source_url: res.source_url,
          },
        ]);
        refreshConversations();
        return true;
      } catch (e) {
        setMessages((m) => m.map((x) => (x.id === localId ? { ...x, failed: true } : x)));
        setError(errorText(e));
        return false;
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending, refreshConversations],
  );

  const retry = useCallback(
    (id) => {
      const msg = messages.find((m) => m.id === id);
      if (!msg) return;
      setMessages((m) => m.filter((x) => x.id !== id));
      send(msg.content);
    },
    [messages, send],
  );

  const open = useCallback(async (id) => {
    setError('');
    try {
      const conv = await api.getConversation(id);
      setConversationId(conv.id);
      setMessages(
        conv.messages.map((m) => ({
          id: `${m.role === 'user' ? 'u' : 'a'}-${m.id}`,
          role: m.role,
          content: m.content,
          found: m.found,
          article_title: m.article_title,
          source_url: m.source_url,
        })),
      );
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  const remove = useCallback(
    async (id) => {
      try {
        await api.deleteConversation(id);
        if (id === conversationId) {
          setConversationId(null);
          setMessages([]);
        }
        await refreshConversations();
      } catch (e) {
        setError(errorText(e));
      }
    },
    [conversationId, refreshConversations],
  );

  const reset = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setError('');
  }, []);

  return { conversationId, messages, sending, error, conversations, listError, send, retry, open, remove, reset, refreshConversations };
}
