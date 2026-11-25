"use client";
import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import { useGuard, Shell, Empty, Err, Meetings, ChatPanel } from "@/components/ui";

const TABS = [["catalog", "Спеціалісти"], ["ai", "ШІ-помічник"], ["chat", "Чат"], ["meetings", "Мої зустрічі"]];
const PROF = { accountant: "Бухгалтер", lawyer: "Юрист" };

export default function FopCabinet() {
  const user = useGuard("fop"); const [tab, setTab] = useState("catalog");
  const [meetings, setMeetings] = useState([]); const [err, setErr] = useState("");
  const loadMeetings = () => api("/appointments/my").then(setMeetings).catch(() => {});
  useEffect(() => { if (user) loadMeetings(); }, [user]);
  if (!user) return null;
  const pay = async (id) => { setErr(""); try { await api(`/appointments/${id}/pay`, { method: "POST" }); loadMeetings(); } catch (e) { setErr(e.message); } };
  const peers = [...new Map(meetings.map((m) => [m.peer_id, { id: m.peer_id, name: m.peer_name }])).values()];
  return (
    <Shell user={user} tabs={TABS} tab={tab} setTab={setTab}>
      <Err msg={err} />
      {tab === "catalog" && <Catalog onBooked={() => { loadMeetings(); setTab("meetings"); }} />}
      {tab === "ai" && <Assistant />}
      {tab === "chat" && <ChatPanel peers={peers} />}
      {tab === "meetings" && <Meetings items={meetings} onPay={pay} canPay />}
    </Shell>
  );
}

function Catalog({ onBooked }) {
  const [list, setList] = useState(null); const [prof, setProf] = useState(""); const [q, setQ] = useState(""); const [err, setErr] = useState("");
  useEffect(() => { api("/specialists").then(setList).catch((e) => { setErr(e.message); setList([]); }); }, []);
  const shown = (list || []).filter((s) => (!prof || s.profession === prof) && s.full_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <section>
      <div className="mb-5 flex flex-wrap gap-3">
        <input className="inp max-w-xs" placeholder="Пошук за іменем" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp max-w-[180px]" value={prof} onChange={(e) => setProf(e.target.value)}>
          <option value="">Усі фахівці</option><option value="accountant">Бухгалтери</option><option value="lawyer">Юристи</option>
        </select>
      </div>
      <Err msg={err} />
      {list && !shown.length && <Empty>Нікого не знайдено. Змініть фільтр.</Empty>}
      <div className="grid gap-4 md:grid-cols-2">{shown.map((s) => <SpecialistCard key={s.id} s={s} onBooked={onBooked} />)}</div>
    </section>
  );
}

function SpecialistCard({ s, onBooked }) {
  const [svc, setSvc] = useState(s.services?.[0]?.id); const [slot, setSlot] = useState(s.slots?.[0] || "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const current = s.services?.find((x) => x.id === svc);
  async function payNow() {
    setErr(""); setBusy(true);
    try {
      const a = await api("/appointments", { method: "POST", body: { specialist_id: s.id, service_id: svc, slot: new Date(slot).toISOString() } });
      await api(`/appointments/${a.id}/pay`, { method: "POST" }); onBooked();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <article className="card space-y-4">
      <div><h3 className="font-semibold">{s.full_name}</h3><p className="text-sm text-brand">{PROF[s.profession] || s.profession}</p>
        {s.bio && <p className="mt-1 text-sm text-ink/60">{s.bio}</p>}</div>
      {!s.services?.length ? <p className="text-sm text-ink/50">Прайс-лист ще не заповнено.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {s.services.map((x) => (
            <li key={x.id}><label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
              <span className="flex items-center gap-2"><input type="radio" name={`s${s.id}`} checked={svc === x.id} onChange={() => setSvc(x.id)} className="accent-brand" />{x.title}</span>
              <b>{money(x.price)}</b></label></li>))}
        </ul>)}
      {s.slots?.length
        ? <select className="inp" value={slot} onChange={(e) => setSlot(e.target.value)}>{s.slots.map((t) => <option key={t} value={t}>{new Date(t).toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" })}</option>)}</select>
        : <input className="inp" type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} />}
      <Err msg={err} />
      <button className="btn w-full" disabled={busy || !svc || !slot} onClick={payNow}>
        {busy ? "Оплата…" : current ? `Оплатити ${money(current.price)}` : "Оплатити"}
      </button>
    </article>
  );
}

function Assistant() {
  const [log, setLog] = useState([]); const [q, setQ] = useState(""); const [busy, setBusy] = useState(false);
  async function ask(e) {
    e.preventDefault(); if (!q.trim() || busy) return;
    const question = q; setQ(""); setBusy(true); setLog((l) => [...l, { role: "user", text: question }]);
    try { const d = await api("/ai/ask", { method: "POST", body: { question } }); setLog((l) => [...l, { role: "ai", ...d }]); }
    catch (x) { setLog((l) => [...l, { role: "ai", error: x.message }]); } finally { setBusy(false); }
  }
  return (
    <div className="flex h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {!log.length && <p className="pt-16 text-center text-sm text-ink/50">Запитайте про єдиний податок, ЄСВ, звітність чи договори.<br />Відповідь буде зі ссилкою на джерело.</p>}
        {log.map((m, i) => m.role === "user"
          ? <div key={i} className="ml-auto max-w-[75%] rounded-2xl bg-brand px-4 py-2 text-sm text-white">{m.text}</div>
          : <div key={i} className="max-w-[85%] space-y-3 rounded-2xl bg-paper px-4 py-3 text-sm">
              {m.error ? <p className="text-red-700">{m.error}</p> : <>
                <p>{m.summary || m.answer}</p>
                {!!m.steps?.length && <ol className="list-decimal space-y-1 pl-5">{m.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>}
                {m.source && <a href={m.source.url} target="_blank" rel="noreferrer" className="inline-block rounded-md border border-line bg-white px-2.5 py-1 text-xs text-brand underline-offset-2 hover:underline">Джерело: {m.source.title || m.source.url}</a>}
              </>}
            </div>)}
        {busy && <p className="text-sm text-ink/40">Помічник шукає відповідь…</p>}
      </div>
      <form onSubmit={ask} className="flex gap-2 border-t border-line p-3">
        <input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Наприклад: коли сплачувати ЄСВ за 2026 рік?" />
        <button className="btn" disabled={busy}>Запитати</button>
      </form>
    </div>
  );
}
