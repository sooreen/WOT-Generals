// Снимает с вики Wargaming всё, что относится к World of Tanks Generals:
// список карт (namespace Card: = 10006), викитекст каждой карты и страницы правил.
// Результат — data/raw/wiki/**.wiki + манифест со статусом каждой страницы.

import { writeFile, mkdir } from 'node:fs/promises';
import { get, fetchRaw, log, WIKI } from './lib/http.mjs';

const OUT = 'data/raw/wiki';
const CARD_NS = 10006;

// Страницы правил, живые на момент сбора. Список выверен запросами:
// часть страниц раздела удалена в 2019 году и восстанавливается отдельно из Wayback.
const RULES_PAGES = [
  'Штаб',
  'Техника',
  'Взводы',
  'Приказы',
  'Игровые термины (WoTG)',
  'Примеры колод',
  'Видео (WoTG)',
  'Шаблон:Wotg Card',
];

// Страницы, удалённые с вики. Пробуем — вдруг восстановили; иначе пойдут в Wayback.
const DELETED_PAGES = [
  'Руководство по игре (WoTG)',
  'Свойства карт (WoTG)',
  'Премиумные карты (WoTG)',
  'Список обновлений (WoTG)',
  'Обновление 0.6.0 (WoTG)',
  'Обновление 0.6.2 (WoTG)',
  'Обновление 0.6.4 (WoTG)',
  'Дерево исследований (WoTG)',
];

function safeName(title) {
  return title.replace(/[/\\:*?"<>|]/g, '_');
}

/** Special:AllPages не имеет API на этой вики — парсим HTML списка. */
async function fetchCardTitles() {
  const url =
    `${WIKI}/index.php?title=${encodeURIComponent('Служебная:Все_страницы')}&namespace=${CARD_NS}`;
  const res = await get(url);
  if (!res.ok) throw new Error(`Не удалось получить список карт: HTTP ${res.status}`);

  const titles = new Set();
  for (const m of res.body.matchAll(/title="(Card:[^"]+)"/g)) {
    const t = m[1]
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    // Красные ссылки на несуществующие страницы помечены иначе, но подстрахуемся.
    if (!t.includes('(страница не существует)')) titles.add(t);
  }
  return [...titles].sort();
}

async function main() {
  await mkdir(`${OUT}/cards`, { recursive: true });
  await mkdir(`${OUT}/rules`, { recursive: true });

  const manifest = { fetchedAt: new Date().toISOString(), cards: [], rules: [], deleted: [] };

  log('→ Получаю список карт из namespace Card:');
  const titles = await fetchCardTitles();
  log(`  найдено страниц: ${titles.length}`);

  let empty = 0;
  let missing = 0;
  for (const [i, title] of titles.entries()) {
    const text = await fetchRaw(title);
    const status = text === null ? 'missing' : text.trim() === '' ? 'empty' : 'ok';
    if (status === 'missing') missing++;
    if (status === 'empty') empty++;
    if (text !== null) {
      await writeFile(`${OUT}/cards/${safeName(title)}.wiki`, text, 'utf8');
    }
    manifest.cards.push({ title, status, bytes: text?.length ?? 0 });
    if ((i + 1) % 40 === 0) log(`  ${i + 1}/${titles.length}`);
  }
  log(`  карты: ok=${titles.length - empty - missing} пустых=${empty} отсутствуют=${missing}`);

  log('→ Страницы правил');
  for (const title of RULES_PAGES) {
    const text = await fetchRaw(title);
    const status = text === null ? 'missing' : text.trim() === '' ? 'empty' : 'ok';
    if (text !== null) await writeFile(`${OUT}/rules/${safeName(title)}.wiki`, text, 'utf8');
    manifest.rules.push({ title, status, bytes: text?.length ?? 0 });
    log(`  ${status.padEnd(8)} ${title} (${text?.length ?? 0} б)`);
  }

  log('→ Проверяю удалённые страницы (ожидаемо 404 → пойдут в Wayback)');
  for (const title of DELETED_PAGES) {
    const text = await fetchRaw(title);
    const status = text === null ? 'missing' : 'ok';
    if (text !== null) await writeFile(`${OUT}/rules/${safeName(title)}.wiki`, text, 'utf8');
    manifest.deleted.push({ title, status });
    log(`  ${status.padEnd(8)} ${title}`);
  }

  await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2), 'utf8');
  log(`\n✓ Готово. Манифест: ${OUT}/manifest.json`);
}

main().catch((err) => {
  console.error('ОШИБКА:', err);
  process.exit(1);
});
