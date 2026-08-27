// Викитекст → нормализованная база карт.
// Выход: data/cards.json, data/cards.csv, data/research-tree.json, data/parse-report.json
//
// Принцип: ничего не выбрасываем молча. Всё, что не удалось разобрать или что
// противоречит другому источнику, попадает в parse-report.json и затем в документацию.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { extractTemplate, parseParams, cleanValue, toNumber, wikiToPlain, parseAbilities, parseStat }
  from './lib/wikitext.mjs';
import { fromImageCode, fromDescription, NATION_RU, VEHICLE_CLASS_RU, HQ_TYPE_RU, PLATOON_SPEC_RU }
  from './lib/classify.mjs';

const IN = 'data/raw/wiki/cards';
const OUT = 'data';
const MANUAL = 'data/manual';

/** Файл может отсутствовать при первом прогоне — это не ошибка. */
async function readJsonOrEmpty(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

const KIND_RU = { vehicle: 'Техника', hq: 'Штаб', platoon: 'Взвод', order: 'Приказ' };

// |Вид карты — как карта попадает к игроку.
const RARITY = {
  Norm: 'normal',       // обычная, исследуется в дереве
  Prem: 'premium',      // за золото
  Start: 'starter',     // стартовая колода
  Training: 'training', // учебная
  Gift: 'gift',         // подарочная
  Naem: 'mercenary',    // «наёмник» — вне дерева своей нации
  Del: 'removed',       // выведена из игры
};

const RARITY_RU = {
  normal: 'Обычная',
  premium: 'Премиумная',
  starter: 'Стартовая',
  training: 'Учебная',
  gift: 'Подарочная',
  mercenary: 'Наёмник',
  removed: 'Удалена из игры',
};

function titleFromFile(name) {
  return name.replace(/\.wiki$/, '').replace(/^Card_/, '');
}

/** «Card:Die_Glorien» → «Die Glorien» */
function normalizeCardRef(ref) {
  return ref.replace(/^Card:/, '').replace(/_/g, ' ').trim();
}

/** Список карт из полей «Предыдущая/Следующая карта»: «A, B, C» → [A, B, C]. */
function parseCardList(value) {
  const v = cleanValue(value);
  if (!v || v === '-' || v === '—') return [];
  return wikiToPlain(v)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '-' && s !== '—');
}

async function main() {
  await mkdir(OUT, { recursive: true });
  // Классы техники, восстановленные из энциклопедии World of Tanks
  // для карт, у которых на вики WoTG нет описания (см. resolve-classes.mjs).
  const classOverrides = await readJsonOrEmpty(`${MANUAL}/vehicle-classes.json`);
  const files = (await readdir(IN)).filter((f) => f.endsWith('.wiki')).sort();

  // Читаем всё в память один раз: файлы мелкие, зато можно сделать два прохода.
  const sources = [];
  for (const file of files) {
    sources.push({ file, title: titleFromFile(file), text: await readFile(`${IN}/${file}`, 'utf8') });
  }

  // Проход 1 — нация каждой ветки исследования.
  // Ветка целиком принадлежит одной нации, поэтому большинство голосов внутри ветки
  // надёжнее одиночного признака и позволяет пережить опечатку в коде отдельной карты.
  const branchVotes = new Map();
  for (const { text } of sources) {
    const body = extractTemplate(text, 'Wotg Card');
    if (!body) continue;
    const p = parseParams(body);
    const branch = cleanValue(p['Штаб'])?.replace(/^-$/, '');
    if (!branch) continue;
    const nat =
      fromImageCode(cleanValue(p['Картинка'])).nation ??
      fromDescription(cleanValue(p['Описание'])).nation;
    if (!nat) continue;
    const tally = branchVotes.get(branch) ?? {};
    tally[nat] = (tally[nat] ?? 0) + 1;
    branchVotes.set(branch, tally);
  }
  const branchNation = new Map(
    [...branchVotes].map(([branch, tally]) => [
      branch,
      Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0],
    ]),
  );

  const cards = [];
  const aliases = {};        // альтернативное имя → каноническое
  const report = {
    parsedAt: new Date().toISOString(),
    totalPages: files.length,
    redirects: 0,
    parsed: 0,
    failures: [],            // страница есть, но шаблон не разобрался
    conflicts: [],           // код картинки и описание говорят разное
    missingFields: {},       // поле → сколько карт без него
    unresolvedClass: [],       // техника без определённого класса
    unresolvedPlatoonSpec: [], // взводы без определённой специализации
  };

  // Проход 2 — разбор карт.
  for (const { title, text } of sources) {

    // Редирект — это алиас: старое или локализованное имя той же карты.
    const redirect = text
      .trim() // часть редиректов на вики записана с ведущим пробелом
      .match(/^#(?:REDIRECT|перенаправление)\s*\[\[([^\]]+)\]\]/i);
    if (redirect) {
      aliases[title] = normalizeCardRef(redirect[1]);
      report.redirects++;
      continue;
    }

    const body = extractTemplate(text, 'Wotg Card');
    if (!body) {
      report.failures.push({ title, reason: 'шаблон {{Wotg Card}} не найден' });
      continue;
    }

    const p = parseParams(body);
    const imageCode = cleanValue(p['Картинка']);
    const byImage = fromImageCode(imageCode);
    const descriptionRaw = cleanValue(p['Описание']);
    const description = wikiToPlain(descriptionRaw);
    const byDesc = fromDescription(descriptionRaw);
    // Код ассета содержит полное английское имя подразделения и часто является
    // единственным источником специализации взвода.
    const bySlug = fromDescription(String(imageCode ?? '').replace(/_/g, ' '));

    // Тип карты: явное поле, иначе код картинки, иначе значение шаблона по умолчанию.
    const declaredKind = cleanValue(p['Тип карты'])?.toLowerCase();
    const kind =
      { vehicle: 'vehicle', hq: 'hq', platoon: 'platoon', order: 'order' }[declaredKind] ??
      byImage.kind ??
      'vehicle';

    // Нация определяется голосованием трёх независимых признаков: код ассета,
    // текст описания и ветка исследования. Слепо доверять коду нельзя — на вики
    // встречаются опечатки (у немецкого Pz35(t) код записан как «uv_», американский).
    const branchName = cleanValue(p['Штаб'])?.replace(/^-$/, '') ?? null;
    const votes = [byImage.nation, byDesc.nation, branchNation.get(branchName) ?? null]
      .filter(Boolean);
    const tally = {};
    for (const v of votes) tally[v] = (tally[v] ?? 0) + 1;
    const nation =
      Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    if (new Set(votes).size > 1) {
      report.conflicts.push({
        title,
        field: 'nation',
        byImage: byImage.nation ?? null,
        byDescription: byDesc.nation ?? null,
        byBranch: branchNation.get(branchName) ?? null,
        resolved: nation,
      });
    }

    const rarityRaw = cleanValue(p['Вид карты']);
    const rarity = RARITY[rarityRaw] ?? (byDesc.premium ? 'premium' : 'normal');

    const platoonBonusRaw = cleanValue(p['Бонус взвода']);
    const platoonBonus =
      platoonBonusRaw === 'Атака' ? 'attack' : platoonBonusRaw === 'Защита' ? 'defence' : null;

    // Уровень, атака, прочность и прирост могут нести дополнительную информацию:
    // метку «Конвейер» и второе, усиленное значение стата.
    const tierStat = parseStat(p['Уровень']);
    const attackStat = parseStat(p['Атака']);
    const hpStat = parseStat(p['Прочность']);
    const incomeStat = parseStat(p['Прирост']);

    const card = {
      id: (byImage.slug ? `${imageCode}` : title).toLowerCase().replace(/\s+/g, '_'),
      name: cleanValue(p['Имя карты']) || title,
      title,
      kind,
      kindRu: KIND_RU[kind],
      nation,
      nationRu: nation ? NATION_RU[nation] : null,
      tier: tierStat.base,
      cost: toNumber(p['Вывод']),          // «Вывод» = стоимость розыгрыша в ресурсах
      attack: attackStat.base,
      hp: hpStat.base,
      income: incomeStat.base,             // прирост ресурсов за ход
      // Значения с учётом национальной/штабной способности карты, если вики их указывает.
      attackBoosted: attackStat.boosted,
      hpBoosted: hpStat.boosted,
      incomeBoosted: incomeStat.boosted,
      // «Конвейер»: в колоде допускается до 10 копий такой карты вместо обычных 3.
      conveyor: tierStat.conveyor,
      rarity,
      rarityRu: RARITY_RU[rarity],
      vehicleClass:
        kind === 'vehicle'
          ? (byDesc.vehicleClass ?? classOverrides[cleanValue(p['Имя карты']) || title]?.vehicleClass ?? null)
          : null,
      vehicleClassRu: null, // проставляется ниже
      vehicleClassSource:
        kind === 'vehicle' && !byDesc.vehicleClass
          ? (classOverrides[cleanValue(p['Имя карты']) || title]?.source ?? null)
          : null,
      hqType: kind === 'hq' ? byDesc.hqType : null,
      hqTypeRu: kind === 'hq' && byDesc.hqType ? HQ_TYPE_RU[byDesc.hqType] : null,
      platoonBonus,
      platoonSpec: kind === 'platoon' ? (byDesc.platoonSpec ?? bySlug.platoonSpec) : null,
      platoonSpecRu: null, // проставляется ниже, когда специализация окончательно известна
      branch: branchName,
      prev: parseCardList(p['Предыдущая карта']),
      next: parseCardList(p['Следующая карта']),
      xp: toNumber(p['Опыт']),
      credits: toNumber(p['Кредиты']),
      description,
      abilities: parseAbilities(p['Способности']),
      oldNames: parseCardList(p['Старые названия']),
      nicknames: parseCardList(p['Прозвища']),
      imageCode,
      imageFile: imageCode ? `Wotg_anno_${imageCode.replace(/\s+/g, '_')}.png` : null,
      sourceUrl: `https://wiki.wargaming.net/ru/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    };

    card.vehicleClassRu = card.vehicleClass ? VEHICLE_CLASS_RU[card.vehicleClass] : null;
    card.platoonSpecRu = card.platoonSpec ? PLATOON_SPEC_RU[card.platoonSpec] : null;
    if (kind === 'vehicle' && !card.vehicleClass) report.unresolvedClass.push(title);
    if (kind === 'platoon' && !card.platoonSpec) report.unresolvedPlatoonSpec.push(title);
    // Отсутствие стата — не всегда пробел: у приказов нет атаки и прочности,
    // а штаб не разыгрывается с руки и потому не имеет стоимости вывода.
    const notApplicable = {
      attack: kind === 'order',
      hp: kind === 'order',
      cost: kind === 'hq',
      income: kind === 'order',
    };
    for (const f of ['tier', 'cost', 'attack', 'hp', 'nation']) {
      if (card[f] == null && !notApplicable[f]) {
        report.missingFields[f] = (report.missingFields[f] ?? 0) + 1;
        (report.missingByCard ??= []).push({ title, field: f });
      }
    }

    cards.push(card);
    report.parsed++;
  }

  cards.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  // Обратный индекс алиасов: каноническая карта → её известные имена.
  const aliasIndex = {};
  for (const [alias, canonical] of Object.entries(aliases)) {
    (aliasIndex[canonical] ??= []).push(alias);
  }
  for (const card of cards) {
    card.aliases = aliasIndex[card.title] ?? aliasIndex[card.name] ?? [];
  }

  // Дерево исследований: узлы сгруппированы по ветке (полю «Штаб»).
  const byName = new Map(cards.map((c) => [c.name, c]));
  const tree = {};
  for (const card of cards) {
    if (!card.branch) continue;
    (tree[card.branch] ??= { branch: card.branch, nation: card.nation, nodes: [] }).nodes.push({
      name: card.name,
      kind: card.kind,
      tier: card.tier,
      xp: card.xp,
      credits: card.credits,
      prev: card.prev,
      next: card.next,
      unknownRefs: [...card.prev, ...card.next].filter((r) => !byName.has(r)),
    });
  }

  await writeFile(`${OUT}/cards.json`, JSON.stringify(cards, null, 2), 'utf8');
  await writeFile(`${OUT}/aliases.json`, JSON.stringify(aliases, null, 2), 'utf8');
  await writeFile(`${OUT}/research-tree.json`, JSON.stringify(tree, null, 2), 'utf8');

  // CSV для таблиц: только скалярные поля, способности схлопнуты в одну ячейку.
  const cols = ['name', 'kindRu', 'nationRu', 'tier', 'cost', 'attack', 'hp', 'income',
    'vehicleClassRu', 'hqTypeRu', 'platoonSpecRu', 'platoonBonus', 'rarityRu', 'branch'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    [...cols, 'abilities'].join(','),
    ...cards.map((c) => [...cols.map((k) => esc(c[k])), esc(c.abilities.join(' | '))].join(',')),
  ].join('\n');
  await writeFile(`${OUT}/cards.csv`, csv, 'utf8');

  await writeFile(`${OUT}/parse-report.json`, JSON.stringify(report, null, 2), 'utf8');

  // Итог в консоль — сразу видно, что собралось, а что нет.
  const by = (key) => {
    const m = {};
    for (const c of cards) m[c[key] ?? '—'] = (m[c[key] ?? '—'] ?? 0) + 1;
    return Object.entries(m).map(([k, v]) => `${k}=${v}`).join(' ');
  };
  console.log(`страниц: ${report.totalPages}  редиректов: ${report.redirects}  карт: ${report.parsed}`);
  console.log(`по типу:    ${by('kindRu')}`);
  console.log(`по нации:   ${by('nationRu')}`);
  console.log(`класс техн: ${by('vehicleClassRu')}`);
  console.log(`не разобран класс: ${report.unresolvedClass.length}`);
  console.log(`сбоев разбора: ${report.failures.length}  конфликтов: ${report.conflicts.length}`);
  console.log(`пустые поля: ${JSON.stringify(report.missingFields)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
