"""Перевірки модуля новин без БД і мережі: правила, розбір RSS/Atom, схеми. python tests/test_news.py"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from datetime import date, datetime, timedelta, timezone

from pydantic import ValidationError

import news_feeds as nf
import news_rules as r
import news_schemas as ns

n = 0


def ck(name, cond, extra=""):
    global n
    print(("OK   " if cond else "FAIL ") + name, extra if not cond else "")
    assert cond, name
    n += 1


def raises(exc, fn, *a, **kw):
    try:
        fn(*a, **kw)
    except exc as e:
        return str(e)
    return None


UTC = timezone.utc
NOW = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)

# ---------- Очищення тексту ----------
ck("strip_html: теги прибрано, сутності розкодовано", r.strip_html("<p>Ставка&nbsp;<b>5%</b> &amp; ЄСВ</p>") == "Ставка 5% & ЄСВ")
ck("strip_html: абзаци дають порожній рядок", r.strip_html("<p>Один</p><p>Два</p>") == "Один\n\nДва")
ck("strip_html: script і style викинуто", "alert" not in r.strip_html("<script>alert(1)</script><p>ок</p><style>p{}</style>"))
ck("strip_html: зламана розмітка не падає", r.strip_html("<p>текст <b>без закриття") .startswith("текст"))
ck("strip_html: порожнє → порожній рядок", r.strip_html(None) == "" and r.strip_html("") == "")
ck("clean_text зводить пробіли", r.clean_text("  а \n\t б  ") == "а б")
ck("clean_multiline: не більше однієї порожньої лінії", r.clean_multiline("а\n\n\n\n\nб") == "а\n\nб")

# ---------- Анонс ----------
ck("make_summary: короткий текст без змін", r.make_summary("Коротко.") == "Коротко.")
long_text = "Перше речення про єдиний податок. " * 30
summary = r.make_summary(long_text)
ck("make_summary: ≤300 символів і закінчується на реченні", len(summary) <= 300 and summary.endswith("."))
no_dots = "слово " * 100
s2 = r.make_summary(no_dots)
ck("make_summary: без крапок різ по слову + «…»", len(s2) <= 301 and s2.endswith("…") and not s2[:-1].endswith("сло"))

# ---------- Посилання ----------
ck("valid_http_url: https ок", r.valid_http_url("https://tax.gov.ua/news/1.html"))
ck("valid_http_url: javascript: відхилено", not r.valid_http_url("javascript:alert(1)"))
ck("valid_http_url: data: відхилено", not r.valid_http_url("data:text/html,<script>"))
ck("valid_http_url: без хоста відхилено", not r.valid_http_url("https://"))
ck("valid_http_url: пробіл відхилено", not r.valid_http_url("https://a.ua/ b"))
ck("valid_http_url: None відхилено", not r.valid_http_url(None))

# ---------- Відбір і категорії ----------
ck("matches_keywords: «Єдиний податок» збігається", r.matches_keywords("Зміни щодо єдиного податку", r.DEFAULT_KEYWORDS))
ck("matches_keywords: регістр не важливий", r.matches_keywords("ЄДИНИЙ ВНЕСОК", r.DEFAULT_KEYWORDS))
ck("matches_keywords: призначення міністра — ні", not r.matches_keywords("Про призначення Хмари Є.Л. на посаду Міністра оборони України", r.DEFAULT_KEYWORDS))
ck("parse_keywords: свій список", r.parse_keywords("Аа, бб ,") == ("аа", "бб"))
ck("parse_keywords: порожнє → типовий", r.parse_keywords("") == r.DEFAULT_KEYWORDS and r.parse_keywords(None) == r.DEFAULT_KEYWORDS)
ck("guess_category: ЄСВ", r.guess_category("Мінімальний єдиний внесок зростає") == "esv")
ck("guess_category: звітність", r.guess_category("Строки подання декларації") == "reporting")
ck("guess_category: податки", r.guess_category("Нова ставка ПДВ") == "taxes")
ck("guess_category: закон", r.guess_category("Постанова Кабміну про порядок") == "law_change")
ck("guess_category: невідоме → other", r.guess_category("Погода на завтра") == "other")
ck("усі категорії мають підпис", set(r.CATEGORIES) == set(r.CATEGORY_LABEL) and all(r.CATEGORY_LABEL.values()))

# ---------- Свіжість ----------
ck("is_fresh: вчора ок", r.is_fresh(NOW - timedelta(days=1), NOW, 30))
ck("is_fresh: 31 день тому — ні", not r.is_fresh(NOW - timedelta(days=31), NOW, 30))
ck("is_fresh: завтра (зсув годинників) ок", r.is_fresh(NOW + timedelta(hours=5), NOW, 30))
ck("is_fresh: через тиждень вперед — ні (помилкова дата)", not r.is_fresh(NOW + timedelta(days=7), NOW, 30))

# ---------- Ліміти публікацій ----------
ck("квота: звичайна стаття дозволена", r.check_publish_quota("normal", 0, 0) is None)
ck("квота: важлива 3-я дозволена", r.check_publish_quota("important", 2, 2) is None)
v = r.check_publish_quota("important", 3, 3)
ck("квота: 4-а важлива — відмова зі зрозумілим текстом", v is not None and v.code == "important_quota" and "3" in v.message)
ck("квота: звичайна при 3 важливих дозволена", r.check_publish_quota("normal", 3, 3) is None)
v = r.check_publish_quota("normal", r.MAX_ARTICLES_PER_DAY, 0)
ck("квота: загальний ліміт на добу", v is not None and v.code == "articles_quota")

# ---------- Розбір стрічок ----------
RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Тест</title>
<item><title>Зміни до Податкового кодексу щодо єдиного податку</title><link>https://example.gov.ua/n/1</link>
<guid>id-1</guid><pubDate>Wed, 25 Nov 2026 09:30:00 +0200</pubDate>
<description><![CDATA[<p>З 1 січня <b>змінюється</b> ставка.</p><p>Деталі в тексті закону.</p>]]></description></item>
<item><title>Про призначення на посаду</title><link>javascript:alert(1)</link><guid>id-2</guid><pubDate>Tue, 24 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title></title><guid>id-3</guid></item>
<item><title>Без дати</title><guid>id-4</guid><description>Текст</description></item>
</channel></rss>""".encode("utf-8")
items = nf.parse_feed(RSS, NOW)
ck("RSS: пропущено запис без заголовка (3 з 4)", len(items) == 3, str(len(items)))
first = items[0]
ck("RSS: новіші першими; запис без дати = «зараз»", first.guid == "id-4" and first.published_at == NOW)
by = {i.guid: i for i in items}
ck("RSS: дата зі зсувом +02:00 приведена до UTC", by["id-1"].published_at == datetime(2026, 11, 25, 7, 30, tzinfo=UTC))
ck("RSS: HTML з CDATA очищено, абзаци збережено", by["id-1"].body == "З 1 січня змінюється ставка.\n\nДеталі в тексті закону.")
ck("RSS: небезпечне посилання відкинуто", by["id-2"].link is None)
ck("RSS: нормальне посилання збережено", by["id-1"].link == "https://example.gov.ua/n/1")

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
<entry><title>Нові правила для ФОП</title><id>tag:x,2026:1</id>
<link rel="self" href="https://example.ua/self"/><link rel="alternate" href="https://example.ua/a/1"/>
<updated>2026-11-26T08:00:00Z</updated><summary type="html">&lt;p&gt;Короткий &amp;amp; зрозумілий опис&lt;/p&gt;</summary></entry>
<entry><title>Другий</title><id>tag:x,2026:2</id><link href="https://example.ua/a/2"/>
<published>2026-11-20T08:00:00+00:00</published><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Вкладений <b>XHTML</b></p></div></content></entry>
</feed>""".encode("utf-8")
a = nf.parse_feed(ATOM, NOW)
ck("Atom: два записи, новіший перший", len(a) == 2 and a[0].guid == "tag:x,2026:1")
ck("Atom: посилання rel=alternate, не self", a[0].link == "https://example.ua/a/1")
ck("Atom: «Z» у даті розпізнано", a[0].published_at == datetime(2026, 11, 26, 8, 0, tzinfo=UTC))
ck("Atom: екранований HTML у summary очищено", a[0].body == "Короткий & зрозумілий опис", repr(a[0].body))
ck("Atom: вкладений XHTML у content дає текст", "Вкладений XHTML" in a[1].body)

RDF = """<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>rdf</title></channel>
<item><title>RDF запис</title><link>https://example.ua/r/1</link><dc:date>2026-11-25T10:00:00+00:00</dc:date></item></rdf:RDF>""".encode("utf-8")
rd = nf.parse_feed(RDF, NOW)
ck("RSS 1.0 (RDF): запис і dc:date розпізнано", len(rd) == 1 and rd[0].published_at == datetime(2026, 11, 25, 10, 0, tzinfo=UTC))

ck("порожня відповідь → FeedError", raises(nf.FeedError, nf.parse_feed, b"   ", NOW) is not None)
ck("не XML → FeedError із поясненням", "XML" in (raises(nf.FeedError, nf.parse_feed, b"<html><body>not xml", NOW) or ""))
ck("HTML-сторінка замість стрічки → FeedError", raises(nf.FeedError, nf.parse_feed, b"<html><head></head><body></body></html>", NOW) is not None)
BOMB = b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><rss><channel><item><title>&b;</title></item></channel></rss>'
ck("XML із DOCTYPE/ENTITY відхилено", "DOCTYPE" in (raises(nf.FeedError, nf.parse_feed, BOMB, NOW) or ""))

ck("external_id стабільний і залежить від стрічки", nf.external_id("u1", "g") == nf.external_id("u1", "g") != nf.external_id("u2", "g"))
ck("external_id вміщається в колонку (≤64)", len(nf.external_id("u", "g")) <= 64)

# ---------- NEWS_FEEDS ----------
src = nf.parse_sources("Законодавство|https://a.ua/rss;Друга|https://b.ua/feed|all\n Третя | https://c.ua/x ")
ck("NEWS_FEEDS: три джерела", [s.name for s in src] == ["Законодавство", "Друга", "Третя"])
ck("NEWS_FEEDS: «all» вимикає фільтр, за замовчуванням фільтр увімкнено", [s.filtered for s in src] == [True, False, True])
ck("NEWS_FEEDS: порожнє → порожній список", nf.parse_sources("") == [] and nf.parse_sources(None) == [])
ck("NEWS_FEEDS: дубль адреси пропущено", len(nf.parse_sources("A|https://a.ua/x;B|https://a.ua/x")) == 1)
ck("NEWS_FEEDS: не-http адреса → FeedError із підказкою формату", "Формат" in (raises(nf.FeedError, nf.parse_sources, "A|ftp://x") or ""))
ck("NEWS_FEEDS: без адреси → FeedError", raises(nf.FeedError, nf.parse_sources, "лише назва") is not None)
ck("fetch_feed: не-http відхилено до мережі", raises(nf.FeedError, nf.fetch_feed, "file:///etc/passwd") is not None)

# ---------- Схеми ----------
ok = ns.NewsCreate(title="  Нові   ліміти  ", body="Достатньо довгий текст статті про зміни.", category="taxes")
ck("NewsCreate: заголовок очищено від зайвих пробілів", ok.title == "Нові ліміти")
ck("NewsCreate: значення за замовчуванням", ok.importance == "normal" and ok.effective_date is None and ok.source_url is None)
ck("NewsCreate: посилання очищується до None, якщо порожнє", ns.NewsCreate(title="Заголовок", body="x" * 25, source_url="  ").source_url is None)
for bad_name, kwargs in {
    "короткий заголовок": dict(title="ab", body="x" * 30),
    "короткий текст": dict(title="Заголовок", body="коротко"),
    "невідома категорія": dict(title="Заголовок", body="x" * 30, category="sport"),
    "невідома важливість": dict(title="Заголовок", body="x" * 30, importance="urgent"),
    "посилання javascript:": dict(title="Заголовок", body="x" * 30, source_url="javascript:alert(1)"),
    "задовгий текст": dict(title="Заголовок", body="x" * (r.BODY_MAX + 1)),
}.items():
    try:
        ns.NewsCreate(**kwargs)
        failed = False
    except ValidationError:
        failed = True
    ck(f"NewsCreate відхиляє: {bad_name}", failed)

up = ns.NewsUpdate(importance="important")
ck("NewsUpdate: частковий — лише передані поля", up.model_fields_set == {"importance"})
up = ns.NewsUpdate(effective_date=None)
ck("NewsUpdate: effective_date=None очищає (поле передане)", "effective_date" in up.model_fields_set and up.effective_date is None)
ck("NewsUpdate: порожній запит відхилено", raises(ValidationError, ns.NewsUpdate) is not None)
ck("NewsUpdate: title=null відхилено", raises(ValidationError, ns.NewsUpdate, title=None) is not None)
ck("NewsUpdate: category=null відхилено", raises(ValidationError, ns.NewsUpdate, category=None) is not None)

item = ns.NewsItemRead(
    id=1, kind="article", title="т", summary="с", category="taxes", category_label="Податки", importance="normal",
    published_at=NOW, updated_at=NOW,
)
ck("NewsItemRead: прапорці за замовчуванням", item.is_read is False and item.is_mine is False and item.edited is False)
ck("NewsItemRead: невідомий kind відхилено", raises(ValidationError, ns.NewsItemRead, **{**item.model_dump(), "kind": "spam"}) is not None)

print(f"\nПройдено перевірок: {n}")
