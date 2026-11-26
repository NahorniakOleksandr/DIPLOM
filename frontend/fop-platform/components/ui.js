'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, session, when } from '@/lib/api';

export const cx = (...parts) => parts.filter(Boolean).join(' ');

// ---------- Іконки (outline, 24×24) ----------
const ICONS = {
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </>
  ),
  sparkle: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />,
  pencil: <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />,
  check: <path d="M5 13l4 4L19 7" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />,
  external: <path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  doc: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </>
  ),
  scale: (
    <>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" />
      <path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </>
  ),
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  video: (
    <>
      <path d="M23 7l-7 5 7 5z" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
};

export function Icon({ name, className = 'h-4 w-4', strokeWidth = 1.8 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

// ---------- Спінер ----------
export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------- Картка ----------
export function Card({ className, children, ...rest }) {
  return (
    <section
      className={cx('rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]', className)}
      {...rest}
    >
      {children}
    </section>
  );
}

// ---------- Кнопка ----------
const BUTTON_VARIANTS = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-300 disabled:bg-blue-300',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 focus-visible:ring-slate-200',
  soft: 'bg-blue-50 text-blue-700 hover:bg-blue-100 focus-visible:ring-blue-200',
  danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50 focus-visible:ring-red-200',
  ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-200',
};
const BUTTON_SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export function Button({ variant = 'secondary', size = 'md', loading = false, className, children, disabled, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-xl font-medium transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-70',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

// ---------- Бейдж ----------
const BADGE_TONES = {
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-600 border-red-100',
};

export function Badge({ tone = 'slate', className, children }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// Кольори тексту статусів (для підписів без «пігулки»)
export const TONE_TEXT = {
  slate: 'text-slate-500',
  blue: 'text-blue-600',
  green: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-500',
};
// Плитки з датою (як у блоці дедлайнів)
export const TONE_TILE = {
  slate: 'bg-slate-50 border-slate-200 text-slate-600',
  blue: 'bg-blue-50 border-blue-100 text-blue-700',
  green: 'bg-emerald-50 border-emerald-100 text-emerald-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  red: 'bg-red-50 border-red-100 text-red-600',
};

// ---------- Поля форм ----------
const FIELD_BASE =
  'w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500';

export function Label({ children, hint, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-slate-700">
      {children}
      {hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...rest }) {
  return <input className={cx(FIELD_BASE, 'h-10', className)} {...rest} />;
}

export function Textarea({ className, ...rest }) {
  return <textarea className={cx(FIELD_BASE, 'py-2.5', className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cx(FIELD_BASE, 'h-10 pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

// ---------- Прогрес-шкала ----------
const BAR_TONES = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-blue-500' };

export function ProgressBar({ percent = 0, tone = 'green' }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
    >
      <div className={cx('h-full rounded-full transition-all duration-500', BAR_TONES[tone])} style={{ width: `${width}%` }} />
    </div>
  );
}

// ---------- Повідомлення, порожні стани ----------
const ALERT_TONES = {
  red: 'border-red-200 bg-red-50 text-red-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  blue: 'border-blue-100 bg-blue-50 text-blue-800',
  green: 'border-emerald-100 bg-emerald-50 text-emerald-800',
};

export function Alert({ tone = 'red', children, action, className }) {
  return (
    <div role="alert" className={cx('flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] leading-5', ALERT_TONES[tone], className)}>
      <Icon name={tone === 'green' ? 'check' : 'alert'} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, action, className }) {
  return (
    <div className={cx('rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center', className)}>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <p className="mt-1 text-xs leading-5 text-slate-500">{children}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cx('animate-pulse rounded-lg bg-slate-100', className)} />;
}

export function Avatar({ name, className }) {
  const letters = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  return (
    <div className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700', className)}>
      {letters || '?'}
    </div>
  );
}

// ---------- Модальне вікно ----------
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', width)}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Закрити"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}


// ======================================================================
// Спільні компоненти сторінки входу та кабінету фахівця (app/page.js, app/specialist/page.js).
// Лишаються без змін поведінки; кабінет фахівця буде переписано на Етапі 3.
// ======================================================================

// Охоронець маршруту: пускає лише користувача з потрібною роллю, інакше веде на вхід.
// Ролі «specialist» і «expert» вважаються однією роллю: бекенд повертає «expert».
export function useGuard(role) {
  const r = useRouter();
  const [s, setS] = useState(null);
  useEffect(() => {
    const x = session.get();
    const isSpecialist = (v) => v === 'specialist' || v === 'expert';
    const allowed = x && (x.role === role || (isSpecialist(role) && isSpecialist(x.role)));
    if (!allowed) r.replace('/');
    else setS(x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return s;
}

export function Shell({ user, tabs, tab, setTab, children }) {
  const r = useRouter();
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between py-5">
        <span className="text-lg font-semibold tracking-tight">ФОП Поруч</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-ink/60">{user.name}</span>
          <button className="btn-ghost" onClick={() => { session.clear(); r.push('/'); }}>Вийти</button>
        </div>
      </header>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm ${tab === id ? 'border-brand font-medium text-brand' : 'border-transparent text-ink/60 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {children}
    </div>
  );
}

export const Empty = ({ children }) => (
  <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-ink/50">{children}</p>
);

export const Err = ({ msg }) =>
  msg ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p> : null;

export function Meetings({ items, onPay, canPay }) {
  if (!items.length) return <Empty>Консультацій поки немає.</Empty>;
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{a.service_title}</p>
            <p className="text-sm text-ink/60">{a.peer_name} · {when(a.slot)}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-xs ${a.status === 'paid' ? 'bg-brand-soft text-brand' : 'bg-amber-50 text-amber-700'}`}>
              {a.status === 'paid' ? 'Оплачено' : 'Очікує оплати'}
            </span>
            {canPay && a.status !== 'paid' && <button className="btn" onClick={() => onPay(a.id)}>Оплатити</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ChatPanel({ peers }) {
  const [peer, setPeer] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const end = useRef();
  const cur = peer ?? peers[0]?.id;
  const load = () => cur && api(`/messages/${cur}`).then(setMsgs).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  if (!peers.length) return <Empty>Чат стане доступним після першої запланованої консультації.</Empty>;
  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text;
    setText('');
    await api('/messages', { method: 'POST', body: { to_id: cur, text: t } }).catch(() => {});
    load();
  }
  return (
    <div className="grid h-[480px] grid-cols-[180px_1fr] overflow-hidden rounded-xl border border-line bg-white">
      <ul className="overflow-y-auto border-r border-line">
        {peers.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => setPeer(p.id)}
              className={`w-full px-4 py-3 text-left text-sm ${p.id === cur ? 'bg-brand-soft font-medium text-brand' : 'hover:bg-paper'}`}
            >
              {p.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex min-h-0 flex-col">
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {!msgs.length && <p className="text-center text-sm text-ink/40">Напишіть перше повідомлення.</p>}
          {msgs.map((m) => (
            <div key={m.id} className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${m.from_id === cur ? 'bg-paper' : 'ml-auto bg-brand text-white'}`}>{m.text}</div>
          ))}
          <div ref={end} />
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
          <input className="inp" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ваше повідомлення" />
          <button className="btn">Надіслати</button>
        </form>
      </div>
    </div>
  );
}
