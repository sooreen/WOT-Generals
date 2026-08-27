// Дорезолвивание класса техники для карт, у которых на вики WoTG нет описания.
//
// Источник — namespace Tank: той же вики (энциклопедия World of Tanks).
// Класс задан вики-ссылкой в аннотации: «Немецкий [[Средние танки|средний танк]]
// девятого уровня» — это машинный признак, а не вольный текст.
//
// Две ловушки, из-за которых наивная версия давала неверные ответы:
//   1. Искать класс по всей странице нельзя — в шаблоне ветки и в тексте обзора
//      попадаются ссылки на другие классы (средний E-50 определялся как ПТ-САУ).
//   2. Совпадения имён омонимичны между нациями — американская карта T28
//      подтягивала советский Т-28. Поэтому нация машины сверяется с нацией карты.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { get, log, WIKI } from './lib/http.mjs';

const OUT = 'data/manual';

const CLASS_LINKS = [
  [/\[\[ПТ-САУ/i, 'td'],
  [/\[\[САУ|\[\[Артиллерия/i, 'spg'],
  [/\[\[Тяж[её]лые танки/i, 'heavy'],
  [/\[\[Средние танки/i, 'medium'],
  [/\[\[Л[её]гкие танки/i, 'light'],
];

// Энциклопедия пишет класс и сокращённо, и полностью:
// «ПТ-САУ» = «противотанковая самоходная артиллерийская установка» = «противотанковая САУ».
const CLASS_TEXT = [
  [/противотанков\S*\s+(?:сау|самоходн)/i, 'td'],
  [/ПТ-САУ/i, 'td'],
  [/самоходн\S*\s+артиллерийск\S*\s+установк/i, 'spg'],
  [/\bСАУ\b/i, 'spg'],
  [/тяж[её]л\S*\s+танк/i, 'heavy'],
  [/средн\S*\s+танк/i, 'medium'],
  [/л[её]гк\S*\s+танк/i, 'light'],
];

// Навигационный шаблон класса в конце страницы. Нужен для машин вроде Tiger (P),
// у которых аннотация написана вольным текстом и класс в ней не назван.
const CLASS_NAVBOX = [
  [/\{\{\s*ПТ-САУ\s*\}\}/i, 'td'],
  [/\{\{\s*САУ\s*\}\}/i, 'spg'],
  [/\{\{\s*Тяж[её]лые\s+Танки\s*\}\}/i, 'heavy'],
  [/\{\{\s*Средние\s+Танки\s*\}\}/i, 'medium'],
  [/\{\{\s*Л[её]гкие\s+Танки\s*\}\}/i, 'light'],
];

// Первая буква поля code шаблона ТанкТТХ кодирует нацию машины.
const CODE_NATION = { G: 'germany', R: 'ussr', A: 'usa' };

const NATION_WORD = [
  [/немецк|герман/i, 'germany'],
  [/американск|сша/i, 'usa'],
  [/советск|ссср/i, 'ussr'],
];

// Кириллические омоглифы, которыми на вики записывают латинские индексы машин.
const HOMOGLYPHS = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x',
};

// Имена, которые нельзя получить транслитерацией: в игре карта названа сокращённо
// или по-русски, а в энциклопедии машина числится под полным именем.
const NAME_MAP = {
  'Валентайн II': ['Valentine II', 'Valentine'],
  'ИС-4': ['IS-4', 'IS-4M'],
  'СУ-101': ['SU-101'],
  'СУ-122-54': ['SU-122-54', 'SU 122 54', 'СУ-122-54 (танк)'],
  'БТ-СВ': ['BT-SV'],
  'А-32': ['A-32'],
  'E-50M': ['E 50 Ausf. M', 'E-50 Ausf. M', 'E 50 M'],
  'M48 Patton': ['M48A1 Patton', 'M48A5 Patton', 'M48A1'],
  'Ru 251': ['Spähpanzer Ru 251', 'Spahpanzer Ru 251'],
  'Т25 AT': ['T25 AT', 'T25/2', 'T25 2'],
  'Т28': ['T28', 'T28 Prototype'],
};

function latinize(name) {
  return [...name].map((ch) => HOMOGLYPHS[ch] ?? ch).join('');
}

/** Перебор правдоподобных заголовков страницы энциклопедии для одной карты. */
function candidates(card) {
  const set = new Set();
  const add = (v) => v && set.add(v.trim());

  add(card.name);
  add(latinize(card.name));
  for (const alt of NAME_MAP[card.name] ?? []) add(alt);
  for (const alias of card.aliases ?? []) add(alias);

  const slug = String(card.imageCode ?? '').replace(/^[gus][vhpo][_\s]+/i, '');
  if (slug) {
    const parts = slug.split(/[_\s]+/).filter(Boolean);
    add(parts.join('-').toUpperCase());
    add(parts.join(' ').toUpperCase());
    add(parts.join('').toUpperCase());
  }

  for (const v of [...set]) {
    add(v.replace(/\s+/g, '-'));
    add(v.replace(/-/g, ' '));
  }
  return [...set];
}

/**
 * Аннотация всегда начинается формулой «<Нация> <класс> <N> уровня», поэтому
 * берём фиксированное окно после «Аннотация =», а не пытаемся найти конец поля:
 * поле заканчивается по-разному ({{Model3DViewer}}, }}, следующий параметр),
 * и попытка поймать конец регуляркой утаскивала в захват всю остальную страницу.
 */
const ANNOTATION_WINDOW = 220;

function extractAnnotation(text) {
  // Шаблон {{ТанкТТХ}} называет поле «Аннотация», {{АннотацияТанк3}} — «content».
  const m = text.match(/\|\s*(?:Аннотация|content)\s*=/i);
  if (!m) return '';
  const start = m.index + m[0].length;
  return text.slice(start, start + ANNOTATION_WINDOW);
}

function detectNation(text, annotation) {
  const code = text.match(/\|\s*code\s*=\s*([A-Za-z]+)/)?.[1] ?? '';
  const byCode = CODE_NATION[code[0]?.toUpperCase()] ?? null;
  let byWord = null;
  for (const [re, nat] of NATION_WORD) {
    if (re.test(annotation)) {
      byWord = nat;
      break;
    }
  }
  return { byWord, byCode };
}

/**
 * Побеждает класс, упомянутый в аннотации РАНЬШЕ других, а не первый по порядку
 * в таблице правил: во фразе «средний танк ... опасен для ПТ-САУ» фиксированный
 * приоритет ПТ-САУ дал бы неверный ответ.
 */
function detectClass(text) {
  const annotation = extractAnnotation(text);
  if (!annotation) return null;

  let best = null;
  for (const [table, via] of [[CLASS_LINKS, 'ссылка в аннотации'], [CLASS_TEXT, 'текст аннотации']]) {
    for (const [re, cls] of table) {
      const at = annotation.search(re);
      if (at !== -1 && (best === null || at < best.at)) best = { cls, at, via };
    }
    if (best) break; // ссылки надёжнее текста — если нашли по ссылкам, текст не смотрим
  }
  // Запасной путь: класс из навигационного шаблона внизу страницы.
  if (!best) {
    for (const [re, cls] of CLASS_NAVBOX) {
      if (re.test(text)) {
        best = { cls, at: 0, via: 'навигационный шаблон класса' };
        break;
      }
    }
  }
  if (!best) return null;

  return { cls: best.cls, via: best.via, nation: detectNation(text, annotation) };
}

async function fetchTank(title, depth = 0) {
  if (depth > 2) return null;
  const url =
    `${WIKI}/index.php?title=${encodeURIComponent(`Tank:${title}`.replace(/ /g, '_'))}&action=raw`;
  const res = await get(url);
  if (!res.ok || !res.body) return null;

  const redirect = res.body.trim().match(/^#(?:REDIRECT|перенаправление)\s*\[\[Tank:([^\]]+)\]\]/i);
  if (redirect) return fetchTank(redirect[1], depth + 1);
  return res.body;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const cards = JSON.parse(await readFile('data/cards.json', 'utf8'));
  const unresolved = cards.filter((c) => c.kind === 'vehicle' && !c.vehicleClass);

  log(`Не определён класс у ${unresolved.length} машин. Ищу в namespace Tank:`);

  const resolved = {};
  const failed = [];

  for (const card of unresolved) {
    let hit = null;
    for (const cand of candidates(card)) {
      const text = await fetchTank(cand);
      if (!text) continue;
      const det = detectClass(text);
      if (!det) continue;

      const found = det.nation.byWord ?? det.nation.byCode;
      if (found && card.nation && found !== card.nation) continue; // омоним другой нации

      hit = { ...det, tankPage: `Tank:${cand}` };
      break;
    }

    if (hit) {
      resolved[card.name] = {
        vehicleClass: hit.cls,
        source: `https://wiki.wargaming.net/ru/${encodeURIComponent(hit.tankPage.replace(/ /g, '_'))}`,
        via: `энциклопедия World of Tanks (${hit.via})`,
      };
      log(`  ✓ ${card.name.padEnd(16)} → ${hit.cls.padEnd(7)} ${hit.tankPage}`);
    } else {
      failed.push(card.name);
      log(`  ✗ ${card.name.padEnd(16)} — не найдено`);
    }
  }

  await writeFile(`${OUT}/vehicle-classes.json`, JSON.stringify(resolved, null, 2), 'utf8');
  log(`\nРазрешено: ${Object.keys(resolved).length}/${unresolved.length}`);
  if (failed.length) log(`Осталось: ${failed.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
