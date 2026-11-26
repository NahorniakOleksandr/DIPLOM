'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon, cx } from '@/components/ui';

/**
 * Спільна шапка кабінетів (ФОП і фахівець): логотип, вкладки, чіп-підказка, меню користувача.
 * tabs: [{ id, label, badge? }] — badge (число > 0) показується біля назви вкладки.
 */
export default function AppHeader({ tabs, tab, onTab, user, onLogout, chip, chipTitle, onChip }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const renderTab = (t, mobile) => (
    <button
      key={t.id}
      type="button"
      onClick={() => onTab(t.id)}
      aria-current={tab === t.id ? 'page' : undefined}
      className={cx(
        'flex items-center gap-1.5 font-medium transition-colors',
        mobile ? 'shrink-0 rounded-lg px-3 py-1.5 text-[13px]' : 'rounded-lg px-3 py-2 text-[13px]',
        tab === t.id ? 'bg-blue-50 text-blue-700' : mobile ? 'text-slate-600' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
      )}
    >
      {t.label}
      {t.badge > 0 && (
        <span className="min-w-[18px] rounded-full bg-amber-500 px-1.5 text-center text-[10px] font-semibold leading-[18px] text-white">
          {t.badge}
        </span>
      )}
    </button>
  );

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-700 text-white">
            <Icon name="shield" className="h-5 w-5" />
          </div>
          <div className="text-[13px] font-semibold leading-4 text-slate-900">
            Податки й закони
            <br />без паніки
          </div>
        </div>

        <nav className="ml-6 hidden flex-1 items-center gap-1 md:flex" aria-label="Розділи кабінету">
          {tabs.map((t) => renderTab(t, false))}
        </nav>

        <div className="ml-auto flex items-center gap-3 md:ml-0">
          {chip && (
            <button
              type="button"
              onClick={onChip}
              className="hidden rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 sm:block"
              title={chipTitle}
            >
              {chip}
            </button>
          )}

          <div className="relative" ref={ref}>
            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-slate-800 hover:bg-slate-50"
              aria-haspopup="menu"
              aria-expanded={menu}
            >
              <span className="max-w-[150px] truncate">{user?.full_name || '…'}</span>
              <Icon name="chevronDown" className="h-3.5 w-3.5 text-slate-400" />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                <div className="px-3 py-2 text-xs text-slate-500">
                  <div className="truncate font-medium text-slate-800">{user?.full_name}</div>
                  <div className="truncate">{user?.email}</div>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={onLogout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                >
                  <Icon name="logout" className="h-4 w-4 text-slate-400" /> Вийти
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 md:hidden" aria-label="Розділи кабінету">
        {tabs.map((t) => renderTab(t, true))}
      </nav>
    </header>
  );
}
