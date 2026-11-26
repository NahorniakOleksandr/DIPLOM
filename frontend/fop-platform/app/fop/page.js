'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { ApiError, errorText, getToken } from '@/lib/api';
import { Alert, Button, Skeleton } from '@/components/ui';
import { todayIso } from '@/lib/format';
import Header from '@/components/fop/Header';
import OverviewTab from '@/components/fop/OverviewTab';
import AiTab from '@/components/fop/AiTab';
import Catalog from '@/components/fop/Catalog';
import ProfileTab from '@/components/fop/ProfileTab';
import IncomeModal from '@/components/fop/IncomeModal';
import BookingDialog from '@/components/fop/BookingDialog';
import ChatDrawer from '@/components/fop/ChatDrawer';
import useAiChat from '@/components/fop/useAiChat';
import NewsFeed from '@/components/news/NewsFeed';
import ImportantNewsModal from '@/components/news/ImportantNewsModal';
import useNewsUnread from '@/components/news/useNewsUnread';

export default function FopCabinetPage() {
  const router = useRouter();

  // ---------- Авторизація ----------
  const [auth, setAuth] = useState({ status: 'loading', user: null, error: '' });

  const checkAuth = useCallback(async () => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    setAuth({ status: 'loading', user: null, error: '' });
    try {
      const user = await api.me();
      if (user.role !== 'fop') {
        router.replace('/specialist');
        return;
      }
      setAuth({ status: 'ready', user, error: '' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/');
        return;
      }
      setAuth({ status: 'error', user: null, error: errorText(e) });
    }
  }, [router]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // ---------- Дані кабінету (усе — з API) ----------
  const [tab, setTab] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [dashError, setDashError] = useState('');
  const [consultations, setConsultations] = useState({ loading: true, items: null, error: '' });
  const [specFilter, setSpecFilter] = useState(null);

  const [incomeOpen, setIncomeOpen] = useState(false);
  const [booking, setBooking] = useState({ open: false, expert: null, conversationId: null });
  const [chatPeer, setChatPeer] = useState(null);
  const [notice, setNotice] = useState('');

  const news = useNewsUnread(auth.status === 'ready');
  const chat = useAiChat();
  const { refreshConversations } = chat;

  const loadDashboard = useCallback(async () => {
    try {
      setDashboard(await api.getDashboard());
      setDashError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/');
        return;
      }
      setDashError(errorText(e));
    }
  }, [router]);

  const loadConsultations = useCallback(async () => {
    try {
      const items = await api.listConsultations();
      setConsultations({ loading: false, items, error: '' });
    } catch (e) {
      setConsultations((c) => ({ loading: false, items: c.items, error: errorText(e) }));
    }
  }, []);

  useEffect(() => {
    if (auth.status !== 'ready') return;
    loadDashboard();
    loadConsultations();
    refreshConversations();
  }, [auth.status, loadDashboard, loadConsultations, refreshConversations]);

  // Статуси записів можуть змінитися на боці фахівця — м'яко оновлюємо, поки відкрито розділ записів
  useEffect(() => {
    if (auth.status !== 'ready' || tab !== 'specialists') return undefined;
    const timer = setInterval(() => !document.hidden && loadConsultations(), 20000);
    return () => clearInterval(timer);
  }, [auth.status, tab, loadConsultations]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  const goTab = useCallback((id) => {
    setTab(id);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openSpecialists = useCallback(
    (specialization) => {
      setSpecFilter(specialization || null);
      goTab('specialists');
    },
    [goTab],
  );

  function logout() {
    api.logout();
    router.replace('/');
  }

  async function onBooked() {
    setBooking({ open: false, expert: null, conversationId: null });
    setNotice('Заявку надіслано. Фахівець підтвердить її, і статус зміниться в розділі «Ваші записи».');
    await loadConsultations();
    goTab('specialists');
  }

  // ---------- Стани завантаження / помилки ----------
  if (auth.status === 'loading') {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-6xl space-y-4">
          <Skeleton className="h-14" />
          <Skeleton className="h-10 w-72" />
          <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-60" /><Skeleton className="h-60" /></div>
        </div>
      </main>
    );
  }

  if (auth.status === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md space-y-4">
          <Alert>{auth.error}</Alert>
          <Button variant="primary" onClick={checkAuth}>Спробувати ще раз</Button>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        tab={tab}
        onTab={goTab}
        profile={dashboard?.profile}
        user={auth.user}
        onLogout={logout}
        newsBadge={news.counts.unread}
      />

      <main className="mx-auto max-w-6xl px-4 py-7">
        {notice && (
          <div className="mb-5">
            <Alert tone="green" action={<button onClick={() => setNotice('')} className="shrink-0 text-xs font-medium underline">Закрити</button>}>
              {notice}
            </Alert>
          </div>
        )}

        {tab === 'overview' && (
          <OverviewTab
            user={auth.user}
            dashboard={dashboard}
            dashError={dashError}
            onReloadDashboard={loadDashboard}
            chat={chat}
            consultations={consultations}
            onUpdateIncome={() => setIncomeOpen(true)}
            onOpenProfile={() => goTab('profile')}
            onOpenAiTab={() => goTab('ai')}
            onAskSpecialist={openSpecialists}
            onEscalate={(conversationId) => setBooking({ open: true, expert: null, conversationId })}
            onBookNew={() => setBooking({ open: true, expert: null, conversationId: null })}
            onOpenBookings={() => openSpecialists(null)}
          />
        )}

        {tab === 'ai' && (
          <AiTab
            chat={chat}
            profile={dashboard?.profile}
            onEscalate={(conversationId) => setBooking({ open: true, expert: null, conversationId })}
            onOpenProfile={() => goTab('profile')}
          />
        )}

        {tab === 'specialists' && (
          <Catalog
            specialization={specFilter}
            onSpecialization={setSpecFilter}
            consultations={consultations}
            onBook={(expert) => setBooking({ open: true, expert, conversationId: null })}
            onChat={setChatPeer}
            onReloadConsultations={loadConsultations}
          />
        )}

        {tab === 'news' && <NewsFeed onUnreadChange={news.setCounts} />}

        {tab === 'profile' && (
          <ProfileTab user={auth.user} profile={dashboard?.profile} onSaved={loadDashboard} />
        )}

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-[11px] text-slate-400">
          <span>{dashboard?.disclaimer || 'Суми й строки — довідкові орієнтири. Перед сплатою звірте дані з ДПС.'}</span>
          <span>ШІ-помічник не замінює консультацію фахівця.</span>
        </footer>
      </main>

      <IncomeModal
        open={incomeOpen}
        onClose={() => setIncomeOpen(false)}
        year={dashboard?.year || Number(todayIso().slice(0, 4))}
        onChanged={loadDashboard}
      />
      <BookingDialog
        open={booking.open}
        onClose={() => setBooking({ open: false, expert: null, conversationId: null })}
        initialExpert={booking.expert}
        conversationId={booking.conversationId}
        conversations={chat.conversations}
        onBooked={onBooked}
      />
      <ChatDrawer peer={chatPeer} meId={auth.user?.id} onClose={() => setChatPeer(null)} />
      <ImportantNewsModal onChanged={news.refresh} />
    </div>
  );
}
