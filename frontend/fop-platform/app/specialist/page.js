'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { ApiError, errorText, getToken } from '@/lib/api';
import { Alert, Button, Skeleton } from '@/components/ui';
import AppHeader from '@/components/AppHeader';
import OverviewTab from '@/components/specialist/OverviewTab';
import RequestsTab from '@/components/specialist/RequestsTab';
import ConsultationsTab from '@/components/specialist/ConsultationsTab';
import ScheduleTab from '@/components/specialist/ScheduleTab';
import ChatTab from '@/components/specialist/ChatTab';
import ProfileTab from '@/components/specialist/ProfileTab';
import ConsultationDrawer from '@/components/specialist/ConsultationDrawer';
import useConsultationActions from '@/components/specialist/useConsultationActions';

const HISTORY_LIMIT = 50;
const POLL_MS = 30000;

export default function SpecialistCabinetPage() {
  const router = useRouter();

  // ---------- Авторизація: токен → /auth/me → роль expert ----------
  const [auth, setAuth] = useState({ status: 'loading', user: null, error: '' });

  const checkAuth = useCallback(async () => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    setAuth({ status: 'loading', user: null, error: '' });
    try {
      const user = await api.me();
      if (user.role !== 'expert') {
        router.replace('/fop');
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
  const [data, setData] = useState({ dashboard: null, requests: null, upcoming: null, history: null, error: '' });
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [chatPeer, setChatPeer] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      const [dashboard, requests, upcoming, history] = await Promise.all([
        api.getExpertDashboard(),
        api.listExpertConsultations({ scope: 'requests' }),
        api.listExpertConsultations({ scope: 'upcoming' }),
        api.listExpertConsultations({ scope: 'history', limit: HISTORY_LIMIT }),
      ]);
      setData({ dashboard, requests, upcoming, history, error: '' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/');
        return;
      }
      setData((d) => ({ ...d, error: errorText(e) }));
    }
  }, [router]);

  useEffect(() => {
    if (auth.status === 'ready') loadAll();
  }, [auth.status, loadAll]);

  // Нові заявки з'являються без перезавантаження: м'яке оновлення, поки вкладка відкрита
  useEffect(() => {
    if (auth.status !== 'ready') return undefined;
    const timer = setInterval(() => !document.hidden && loadAll(), POLL_MS);
    return () => clearInterval(timer);
  }, [auth.status, loadAll]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  // Після дії над консультацією: оновити списки й картку, показати повідомлення
  const onDone = useCallback(
    async (message) => {
      setNotice(message);
      await loadAll();
      setDetailVersion((v) => v + 1);
    },
    [loadAll],
  );
  const actions = useConsultationActions({ onDone });

  const goTab = useCallback((id) => {
    setTab(id);
    setChatPeer(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openChat = useCallback((peer) => {
    setOpenId(null);
    setChatPeer(peer);
    setTab('chat');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openCard = useCallback((item) => setOpenId(item.id), []);

  function logout() {
    api.logout();
    router.replace('/');
  }

  const tabs = useMemo(
    () => [
      { id: 'overview', label: 'Огляд' },
      { id: 'requests', label: 'Заявки', badge: data.dashboard?.pending_count || 0 },
      { id: 'consultations', label: 'Консультації' },
      { id: 'schedule', label: 'Розклад' },
      { id: 'chat', label: 'Чат' },
      { id: 'profile', label: 'Профіль' },
    ],
    [data.dashboard],
  );

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

  const common = { actions, onOpen: openCard, onChat: openChat, error: data.error, onReload: loadAll };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader
        tabs={tabs}
        tab={tab}
        onTab={goTab}
        user={auth.user}
        onLogout={logout}
        chip="Кабінет спеціаліста"
        chipTitle="Відкрити профіль"
        onChip={() => goTab('profile')}
      />

      <main className="mx-auto max-w-6xl px-4 py-7">
        {notice && (
          <div className="mb-5">
            <Alert tone="green" action={<button type="button" onClick={() => setNotice('')} className="shrink-0 text-xs font-medium underline">Закрити</button>}>
              {notice}
            </Alert>
          </div>
        )}

        {tab === 'overview' && (
          <OverviewTab
            user={auth.user}
            dashboard={data.dashboard}
            requests={data.requests}
            upcoming={data.upcoming}
            goTab={goTab}
            {...common}
          />
        )}

        {tab === 'requests' && (
          <RequestsTab requests={data.requests} setup={data.dashboard?.setup} goTab={goTab} {...common} />
        )}

        {tab === 'consultations' && (
          <ConsultationsTab upcoming={data.upcoming} history={data.history} historyLimit={HISTORY_LIMIT} {...common} />
        )}

        {tab === 'schedule' && <ScheduleTab onSaved={loadAll} />}

        {tab === 'chat' && <ChatTab meId={auth.user.id} initialPeer={chatPeer} />}

        {tab === 'profile' && (
          <ProfileTab
            onSaved={(profile) => {
              if (profile) setAuth((a) => ({ ...a, user: { ...a.user, full_name: profile.full_name } }));
              loadAll();
            }}
          />
        )}
      </main>

      <ConsultationDrawer
        id={openId}
        version={detailVersion}
        actions={actions}
        onClose={() => setOpenId(null)}
        onSaved={loadAll}
        onChat={openChat}
      />

      {actions.dialogs}
    </div>
  );
}
