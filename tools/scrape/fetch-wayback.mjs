// Восстановление источников, которых больше нет в живом вебе:
//   1. страницы раздела WoTG, удалённые с вики Wargaming 24.05.2019;
//   2. официальные гайды с портала wotgenerals.com (сайт закрыт).
//
// Wayback периодически отвечает страницей «Temporarily Offline» с кодом 200,
// поэтому ответы проверяются по содержимому, а не только по статусу.

import { writeFile, mkdir } from 'node:fs/promises';
import { get, log } from './lib/http.mjs';

const OUT = 'data/raw/wayback';
const CDX = 'http://web.archive.org/cdx/search/cdx';

// Удалённые страницы вики. Названия взяты из журнала удалений и поисковой выдачи.
const WIKI_PAGES = [
  'Руководство_по_игре_(WoTG)',
  'Свойства_карт_(WoTG)',
  'Премиумные_карты_(WoTG)',
  'Список_обновлений_(WoTG)',
  'Обновление_0.6.0_(WoTG)',
  'Обновление_0.6.2_(WoTG)',
  'Обновление_0.6.4_(WoTG)',
  'Дерево_исследований_(WoTG)',
  'Бой_(WoTG)',
  'Ресурсы_(WoTG)',
  'Колода_(WoTG)',
];

// Разделы официального руководства с портала игры.
const PORTAL_PAGES = [
  'http://wotgenerals.com/en/content/guide/game_rules',
  'http://wotgenerals.com/en/content/guide/game_rules/battle_rules',
  'http://wotgenerals.com/en/content/guide/game_rules/deck_and_cards',
  'http://wotgenerals.com/en/content/guide/cards',
  'http://wotgenerals.com/en/content/guide/cards/types_of_cards',
  'http://wotgenerals.com/en/content/guide/cards/attributes_of_cards',
  'http://wotgenerals.com/en/content/guide/in_battle',
  'http://wotgenerals.com/en/content/guide/newcomers-guide',
  'http://wotgenerals.com/en/content/guide/getting_ready_for_battle',
  'http://wotgenerals.com/en/content/guide/getting_ready_for_battle/editing_a_deck',
  'http://wotgenerals.com/en/content/guide/getting_ready_for_battle/researching_cards',
  'http://wotgenerals.com/en/content/guide/premium_perks',
  'http://wotgenerals.com/en/content/about_game',
];

const OFFLINE_MARKER = /Temporarily Offline|Internet Archive: Temporarily/i;

async function cdxLookup(url) {
  const q = `${CDX}?url=${encodeURIComponent(url)}&fl=timestamp,statuscode&filter=statuscode:200&limit=20&output=text`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await get(q, { useCache: attempt === 1 });
    if (res.ok && res.body && !OFFLINE_MARKER.test(res.body) && !res.body.startsWith('<')) {
      return res.body.trim().split('\n').filter(Boolean).map((l) => l.split(/\s+/)[0]);
    }
    await new Promise((r) => setTimeout(r, 2500 * attempt));
  }
  return [];
}

async function fetchSnapshot(timestamp, url) {
  // id_ отдаёт исходный ответ без панели и скриптов Wayback.
  const res = await get(`https://web.archive.org/web/${timestamp}id_/${url}`);
  if (!res.ok || !res.body || OFFLINE_MARKER.test(res.body)) return null;
  return res.body;
}

/** Полезная часть вики-страницы — контейнер mw-content-text. */
function extractWikiContent(html) {
  const i = html.indexOf('id="mw-content-text"');
  if (i === -1) return null;
  const body = html.slice(i);
  // Признак того, что в снимке страница-заглушка, а не содержимое.
  if (/Эта страница была удалена|Ошибка 404/.test(body)) return null;
  return body;
}

function htmlToText(html) {
  let t = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function safe(name) {
  return name.replace(/[/\\:*?"<>|]/g, '_');
}

async function main() {
  await mkdir(`${OUT}/wiki`, { recursive: true });
  await mkdir(`${OUT}/portal`, { recursive: true });
  const report = { fetchedAt: new Date().toISOString(), wiki: [], portal: [] };

  log('→ Удалённые страницы вики');
  for (const page of WIKI_PAGES) {
    const url = `https://wiki.wargaming.net/ru/${page}`;
    const stamps = await cdxLookup(url);
    if (!stamps.length) {
      log(`  ✗ ${page} — нет снимков`);
      report.wiki.push({ page, status: 'нет снимков' });
      continue;
    }

    let saved = null;
    // Идём от самого свежего снимка к более ранним: свежий может оказаться
    // уже посмертной заглушкой «страница удалена».
    for (const ts of [...stamps].reverse()) {
      const html = await fetchSnapshot(ts, url);
      if (!html) continue;
      const content = extractWikiContent(html);
      if (!content) continue;
      const text = htmlToText(content);
      if (text.length < 400) continue;
      await writeFile(`${OUT}/wiki/${safe(page)}.txt`, text, 'utf8');
      await writeFile(`${OUT}/wiki/${safe(page)}.html`, content, 'utf8');
      saved = { page, timestamp: ts, chars: text.length, snapshot: `https://web.archive.org/web/${ts}/${url}` };
      break;
    }

    if (saved) {
      log(`  ✓ ${page.padEnd(32)} ${saved.chars} симв. (снимок ${saved.timestamp})`);
      report.wiki.push({ ...saved, status: 'ok' });
    } else {
      log(`  ✗ ${page} — содержимое не восстановлено`);
      report.wiki.push({ page, status: 'снимки есть, содержимого нет' });
    }
  }

  log('→ Официальные гайды портала');
  for (const url of PORTAL_PAGES) {
    const stamps = await cdxLookup(url);
    let saved = null;
    for (const ts of [...stamps].reverse()) {
      const html = await fetchSnapshot(ts, url);
      if (!html) continue;
      const text = htmlToText(html);
      // Портал на многие запросы отдавал лендинг вместо страницы гайда —
      // отличаем по характерному маркетинговому тексту.
      if (/Free to Play Turn-Based Card Game/.test(text) && text.length < 2500) continue;
      if (text.length < 500) continue;
      const name = safe(url.split('/guide/')[1] ?? url.split('/').pop());
      await writeFile(`${OUT}/portal/${name}.txt`, text, 'utf8');
      saved = { url, timestamp: ts, chars: text.length };
      break;
    }
    if (saved) {
      log(`  ✓ ${saved.url.split('/').slice(-2).join('/').padEnd(38)} ${saved.chars} симв.`);
      report.portal.push({ ...saved, status: 'ok' });
    } else {
      log(`  ✗ ${url.split('/').slice(-2).join('/')} — только лендинг/нет снимка`);
      report.portal.push({ url, status: 'не восстановлено' });
    }
  }

  await writeFile('data/wayback-report.json', JSON.stringify(report, null, 2), 'utf8');
  const okWiki = report.wiki.filter((x) => x.status === 'ok').length;
  const okPortal = report.portal.filter((x) => x.status === 'ok').length;
  log(`\n✓ Вики: ${okWiki}/${WIKI_PAGES.length}, портал: ${okPortal}/${PORTAL_PAGES.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
