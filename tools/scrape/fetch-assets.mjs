// Загрузка изображений: арты всех карт и иллюстрации/иконки из страниц правил.
//
// Прямые ссылки на файлы строятся без обращения к страницам описания:
// MediaWiki раскладывает файлы по каталогам md5(имя_файла)[0]/md5(имя_файла)[0..1].
// Схема проверена на двух заведомо известных URL, поэтому 154 лишних запроса не нужны.

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { get, log } from './lib/http.mjs';

const CDN = 'https://wiki.wgcdn.co/images';
const CARDS_DIR = 'data/assets/cards';
const UI_DIR = 'data/assets/ui';
const RULES_DIR = 'data/raw/wiki/rules';

/** Первая буква имени файла на вики всегда заглавная — иначе md5 не совпадёт. */
function normalizeFileName(name) {
  const n = name.trim().replace(/\s+/g, '_');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function fileUrl(name) {
  const n = normalizeFileName(name);
  const h = createHash('md5').update(n).digest('hex');
  return `${CDN}/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(n)}`;
}

/** Локальное имя файла: без каталогов и без процентного экранирования. */
function localName(name) {
  return normalizeFileName(name).replace(/[/\\]/g, '_');
}

async function download(name, dir) {
  const url = fileUrl(name);
  const res = await get(url, { binary: true });
  if (!res.ok || !res.body?.length) return { ok: false, name, url, status: res.status };

  // Вики отдаёт HTML-страницу ошибки с кодом 200, если файла нет, — отсеиваем по сигнатуре PNG/JPEG.
  const sig = res.body.subarray(0, 4);
  const isPng = sig[0] === 0x89 && sig[1] === 0x50;
  const isJpg = sig[0] === 0xff && sig[1] === 0xd8;
  if (!isPng && !isJpg) return { ok: false, name, url, status: 'не изображение' };

  await writeFile(`${dir}/${localName(name)}`, res.body);
  return { ok: true, name, url, bytes: res.body.length };
}

async function main() {
  await mkdir(CARDS_DIR, { recursive: true });
  await mkdir(UI_DIR, { recursive: true });

  const cards = JSON.parse(await readFile('data/cards.json', 'utf8'));
  const report = { fetchedAt: new Date().toISOString(), cards: [], ui: [], failed: [] };

  log(`→ Арты карт (${cards.length})`);
  let bytes = 0;
  for (const [i, card] of cards.entries()) {
    if (!card.imageFile) {
      report.failed.push({ kind: 'card', name: card.name, reason: 'нет кода картинки' });
      continue;
    }
    const r = await download(card.imageFile, CARDS_DIR);
    if (r.ok) {
      bytes += r.bytes;
      report.cards.push({ card: card.name, file: localName(card.imageFile), bytes: r.bytes });
    } else {
      report.failed.push({ kind: 'card', name: card.name, file: card.imageFile, reason: r.status });
      log(`  ✗ ${card.name} → ${card.imageFile} (${r.status})`);
    }
    if ((i + 1) % 40 === 0) log(`  ${i + 1}/${cards.length}`);
  }
  log(`  скачано артов: ${report.cards.length}, объём: ${(bytes / 1e6).toFixed(1)} МБ`);

  // Иллюстрации и иконки берём из тех же страниц правил, которые пойдут в документацию.
  log('→ Изображения из страниц правил');
  const uiNames = new Set();
  for (const f of await readdir(RULES_DIR)) {
    const text = await readFile(`${RULES_DIR}/${f}`, 'utf8');
    for (const m of text.matchAll(/\[\[(?:Файл|File|Изображение):([^|\]]+)/g)) {
      uiNames.add(m[1].trim());
    }
  }
  log(`  найдено ссылок на файлы: ${uiNames.size}`);

  let uiBytes = 0;
  for (const name of uiNames) {
    const r = await download(name, UI_DIR);
    if (r.ok) {
      uiBytes += r.bytes;
      report.ui.push({ file: localName(name), bytes: r.bytes });
    } else {
      report.failed.push({ kind: 'ui', file: name, reason: r.status });
      log(`  ✗ ${name} (${r.status})`);
    }
  }
  log(`  скачано иллюстраций: ${report.ui.length}, объём: ${(uiBytes / 1e6).toFixed(1)} МБ`);

  await writeFile('data/assets-report.json', JSON.stringify(report, null, 2), 'utf8');
  log(`\n✓ Всего: ${report.cards.length + report.ui.length} файлов, ` +
      `${((bytes + uiBytes) / 1e6).toFixed(1)} МБ, не удалось: ${report.failed.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
