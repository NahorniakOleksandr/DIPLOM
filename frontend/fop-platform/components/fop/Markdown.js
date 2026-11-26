'use client';

import { Fragment } from 'react';

// Мінімальний безпечний рендер відповіді ШІ: **жирний**, списки, нумерація, посилання.
// Без dangerouslySetInnerHTML — увесь текст виводиться як текст React.

const INLINE = /(\*\*[^*]+\*\*|https?:\/\/[^\s<>"')\]]+)/g;

function inline(text, keyPrefix) {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
    }
    if (/^https?:\/\//.test(part)) {
      const href = part.replace(/[.,;:]+$/, '');
      const tail = part.slice(href.length);
      return (
        <Fragment key={key}>
          <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-700">
            {href}
          </a>
          {tail}
        </Fragment>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function parse(text) {
  const blocks = [];
  let list = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) { list = null; continue; }

    const heading = line.match(/^\*\*([^*]+)\*\*:?$/);
    if (heading) { list = null; blocks.push({ type: 'heading', text: heading[1] }); continue; }

    const bullet = line.match(/^[-•*]\s+(.*)$/);
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const kind = numbered ? 'numbered' : 'bullet';
      if (!list || list.kind !== kind) { list = { type: 'list', kind, items: [] }; blocks.push(list); }
      list.items.push(numbered ? numbered[2] : bullet[1]);
      continue;
    }
    list = null;
    blocks.push({ type: 'p', text: line });
  }
  return blocks;
}

export default function Markdown({ text }) {
  const blocks = parse(text);
  return (
    <div className="space-y-2 text-[13px] leading-6 text-slate-700">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return <h4 key={i} className="pt-1 text-sm font-semibold text-slate-900 first:pt-0">{b.text}</h4>;
        }
        if (b.type === 'list' && b.kind === 'numbered') {
          return (
            <ol key={i} className="space-y-1.5">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-3">
                  <span className="mt-0.5 w-5 shrink-0 text-[11px] font-semibold tabular-nums text-blue-600">{String(j + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1">{inline(it, `n${i}-${j}`)}</span>
                </li>
              ))}
            </ol>
          );
        }
        if (b.type === 'list') {
          return (
            <ul key={i} className="space-y-1.5">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                  <span className="min-w-0 flex-1">{inline(it, `b${i}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(b.text, `p${i}`)}</p>;
      })}
    </div>
  );
}
