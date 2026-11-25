"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, session, when } from "@/lib/api";

export function useGuard(role) {
  const r = useRouter(); const [s, setS] = useState(null);
  useEffect(() => { const x = session.get(); if (!x || x.role !== role) r.replace("/"); else setS(x); }, []);
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
          <button className="btn-ghost" onClick={() => { session.clear(); r.push("/"); }}>Вийти</button>
        </div>
      </header>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm ${tab === id ? "border-brand font-medium text-brand" : "border-transparent text-ink/60 hover:text-ink"}`}>
            {label}
          </button>))}
      </nav>
      {children}
    </div>
  );
}

export const Empty = ({ children }) => <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-ink/50">{children}</p>;
export const Err = ({ msg }) => msg ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p> : null;

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
            <span className={`rounded-full px-2.5 py-1 text-xs ${a.status === "paid" ? "bg-brand-soft text-brand" : "bg-amber-50 text-amber-700"}`}>
              {a.status === "paid" ? "Оплачено" : "Очікує оплати"}
            </span>
            {canPay && a.status !== "paid" && <button className="btn" onClick={() => onPay(a.id)}>Оплатити</button>}
          </div>
        </li>))}
    </ul>
  );
}

export function ChatPanel({ peers }) {
  const [peer, setPeer] = useState(null); const [msgs, setMsgs] = useState([]); const [text, setText] = useState("");
  const end = useRef(); const cur = peer ?? peers[0]?.id;
  const load = () => cur && api(`/messages/${cur}`).then(setMsgs).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [cur]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  if (!peers.length) return <Empty>Чат стане доступним після першої запланованої консультації.</Empty>;
  async function send(e) {
    e.preventDefault(); if (!text.trim()) return;
    const t = text; setText("");
    await api("/messages", { method: "POST", body: { to_id: cur, text: t } }).catch(() => {}); load();
  }
  return (
    <div className="grid h-[480px] grid-cols-[180px_1fr] overflow-hidden rounded-xl border border-line bg-white">
      <ul className="overflow-y-auto border-r border-line">
        {peers.map((p) => (
          <li key={p.id}><button onClick={() => setPeer(p.id)}
            className={`w-full px-4 py-3 text-left text-sm ${p.id === cur ? "bg-brand-soft font-medium text-brand" : "hover:bg-paper"}`}>{p.name}</button></li>))}
      </ul>
      <div className="flex min-h-0 flex-col">
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {!msgs.length && <p className="text-center text-sm text-ink/40">Напишіть перше повідомлення.</p>}
          {msgs.map((m) => (
            <div key={m.id} className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${m.from_id === cur ? "bg-paper" : "ml-auto bg-brand text-white"}`}>{m.text}</div>))}
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
