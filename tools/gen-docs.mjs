// Генерация машинных разделов документации.
//
// Всё, что можно вывести из данных, генерируется, а не пишется руками:
// каталог карт, разделы по фракциям, глоссарий, история версий и список источников.
// Так документация не расходится с data/*.json при повторном сборе.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { wikiToMarkdown } from './lib/wiki2md.mjs';

const DOCS = 'docs';
const NATION_DIR = `${DOCS}/06-фракции`;

const cards = JSON.parse(await readFile('data/cards.json', 'utf8'));
const tree = JSON.parse(await readFile('data/research-tree.json', 'utf8'));
const coverage = JSON.parse(await readFile('data/abilities-coverage.json', 'utf8'));
const parseReport = JSON.parse(await readFile('data/parse-report.json', 'utf8'));

const readJsonSafe = async (p) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
};
const assetsReport = await readJsonSafe('data/assets-report.json');
const waybackReport = await readJsonSafe('data/wayback-report.json');

const NATIONS = [
  { key: 'ussr', ru: 'СССР', file: 'ссср.md' },
  { key: 'germany', ru: 'Германия', file: 'германия.md' },
  { key: 'usa', ru: 'США', file: 'сша.md' },
];

const GENERATED = '<!-- Файл создан автоматически: pnpm docs:build. Правки вносите в генератор. -->';

const art = (card) => (card.imageFile ? `../data/assets/cards/${card.imageFile}` : null);
const artIn = (card, depth) =>
  card.imageFile ? `${'../'.repeat(depth)}data/assets/cards/${card.imageFile}` : null;

function statLine(card) {
  const parts = [];
  if (card.kind !== 'hq') parts.push(`цена ${card.cost ?? '—'}`);
  if (card.kind !== 'order') {
    parts.push(`атака ${card.attack ?? '—'}`);
    parts.push(`прочность ${card.hp ?? '—'}`);
  }
  if (card.income != null) parts.push(`прирост ${card.income}`);
  return parts.join(' · ');
}

function boostNote(card) {
  const notes = [];
  if (card.attackBoosted != null) notes.push(`атака до ${card.attackBoosted} со способностью`);
  if (card.hpBoosted != null) notes.push(`прочность до ${card.hpBoosted} со способностью`);
  if (card.incomeBoosted != null) notes.push(`прирост до ${card.incomeBoosted} со способностью`);
  return notes.length ? ` _(${notes.join(', ')})_` : '';
}

// ── Каталог всех карт ────────────────────────────────────────────────────────
function buildCatalogue() {
  const lines = [
    '# Каталог карт',
    '',
    GENERATED,
    '',
    `Всего карт в базе: **${cards.length}**. Источник — раздел World of Tanks Generals`,
    'на официальной вики Wargaming (пространство имён `Card:`).',
    '',
    'Изображения — оригинальные арты карт, скачанные с `wiki.wgcdn.co`.',
    '',
  ];

  const kinds = [
    ['hq', 'Штабы'],
    ['vehicle', 'Техника'],
    ['platoon', 'Взводы'],
    ['order', 'Приказы'],
  ];

  for (const [kind, title] of kinds) {
    const group = cards.filter((c) => c.kind === kind);
    lines.push(`## ${title} (${group.length})`, '');

    for (const nation of NATIONS) {
      const nationCards = group
        .filter((c) => c.nation === nation.key)
        .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || a.name.localeCompare(b.name, 'ru'));
      if (!nationCards.length) continue;

      lines.push(`### ${title} — ${nation.ru} (${nationCards.length})`, '');
      lines.push('| Арт | Карта | Ур. | Характеристики | Особенности | Способности |');
      lines.push('| --- | --- | --- | --- | --- | --- |');

      for (const c of nationCards) {
        const image = art(c) ? `<img src="${art(c)}" width="70">` : '—';
        const traits = [c.vehicleClassRu, c.hqTypeRu, c.platoonSpecRu,
          c.platoonBonus === 'attack' ? 'атакующий' : c.platoonBonus === 'defence' ? 'защитный' : null,
          c.rarity !== 'normal' ? c.rarityRu : null,
          c.conveyor ? 'Конвейер' : null,
        ].filter(Boolean).join(', ') || '—';
        const abilities = c.abilities.length
          ? c.abilities.map((a) => a.replace(/\n/g, ' ').replace(/\|/g, '\\|')).join('<br>')
          : '—';
        lines.push(
          `| ${image} | **${c.name}** | ${c.tier ?? '—'} | ${statLine(c)}${boostNote(c)} | ${traits} | ${abilities} |`,
        );
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ── Разделы по фракциям ──────────────────────────────────────────────────────
function buildNation(nation) {
  const own = cards.filter((c) => c.nation === nation.key);
  const hqs = own.filter((c) => c.kind === 'hq');
  const byClass = {};
  for (const c of own.filter((c) => c.kind === 'vehicle')) {
    (byClass[c.vehicleClassRu ?? '—'] ??= []).push(c);
  }

  const lines = [
    `# Фракция: ${nation.ru}`,
    '',
    GENERATED,
    '',
    `Карт нации в базе: **${own.length}** — ` +
      `${hqs.length} штабов, ${own.filter((c) => c.kind === 'vehicle').length} единиц техники, ` +
      `${own.filter((c) => c.kind === 'platoon').length} взводов, ` +
      `${own.filter((c) => c.kind === 'order').length} приказов.`,
    '',
    '## Штабы',
    '',
    'Тип штаба задаёт стиль игры и включает зависимые свойства карт.',
    '',
    '| Арт | Штаб | Тип | Ур. | Атака | Прочность | Прирост | Способности |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const hq of hqs.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0))) {
    const image = artIn(hq, 2) ? `<img src="${artIn(hq, 2)}" width="70">` : '—';
    lines.push(
      `| ${image} | **${hq.name}** | ${hq.hqTypeRu ?? '—'} | ${hq.tier ?? '—'} | ${hq.attack ?? '—'} | ` +
        `${hq.hp ?? '—'} | ${hq.income ?? '—'} | ${hq.abilities.join('<br>').replace(/\|/g, '\\|') || '—'} |`,
    );
  }

  lines.push('', '## Техника по классам', '');
  for (const [cls, list] of Object.entries(byClass).sort()) {
    lines.push(`### ${cls} (${list.length})`, '');
    lines.push('| Карта | Ур. | Цена | Атака | Прочность | Прирост | Способности |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const c of list.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0))) {
      lines.push(
        `| **${c.name}** | ${c.tier ?? '—'} | ${c.cost ?? '—'} | ${c.attack ?? '—'} | ${c.hp ?? '—'} | ` +
          `${c.income ?? '—'} | ${c.abilities.join('<br>').replace(/\|/g, '\\|') || '—'} |`,
      );
    }
    lines.push('');
  }

  // Деревья исследований этой нации.
  const branches = Object.values(tree).filter((b) => b.nation === nation.key);
  if (branches.length) {
    lines.push('## Деревья исследований', '');
    lines.push('Ветка привязана к штабу: изучив все её карты, игрок получал элитный статус штаба.', '');
    for (const branch of branches.sort((a, b) => a.branch.localeCompare(b.branch, 'ru'))) {
      lines.push(`### Ветка «${branch.branch}» (${branch.nodes.length} карт)`, '');
      lines.push('| Карта | Тип | Ур. | Опыт | Кредиты | Открывается после | Открывает |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- |');
      const kindRu = { vehicle: 'техника', hq: 'штаб', platoon: 'взвод', order: 'приказ' };
      for (const n of branch.nodes.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0))) {
        lines.push(
          `| **${n.name}** | ${kindRu[n.kind] ?? n.kind} | ${n.tier ?? '—'} | ${n.xp ?? '—'} | ` +
            `${n.credits ?? '—'} | ${n.prev.join(', ') || '—'} | ${n.next.join(', ') || '—'} |`,
        );
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Глоссарий ────────────────────────────────────────────────────────────────
async function buildGlossary() {
  const raw = await readFile('data/raw/wiki/rules/Игровые термины (WoTG).wiki', 'utf8');
  const body = wikiToMarkdown(raw, { imageBase: '../data/assets/ui' });
  return [
    '# Глоссарий игровых терминов',
    '',
    GENERATED,
    '',
    'Словарь сообщества и официальные термины. Источник — страница',
    '[«Игровые термины (WoTG)»](https://wiki.wargaming.net/ru/Игровые_термины_(WoTG))',
    'на вики Wargaming.',
    '',
    body,
    '',
  ].join('\n');
}

// ── История версий ───────────────────────────────────────────────────────────
async function buildHistory() {
  const dir = 'data/raw/wayback/wiki';
  let files = [];
  try { files = await readdir(dir); } catch { /* каталога может не быть */ }

  const patches = files.filter((f) => /Обновление|Список_обновлений/.test(f) && f.endsWith('.txt')).sort();
  const lines = [
    '# История версий',
    '',
    GENERATED,
    '',
    'Страницы с патчноутами удалены с вики Wargaming 24 мая 2019 года.',
    'Тексты ниже восстановлены из архивных снимков Wayback Machine.',
    '',
  ];

  if (!patches.length) {
    lines.push('> Восстановить патчноуты не удалось: снимки недоступны.', '');
    return lines.join('\n');
  }

  for (const file of patches) {
    const raw = await readFile(`${dir}/${file}`, 'utf8');
    const title = file.replace(/\.txt$/, '').replace(/_/g, ' ');
    // Отрезаем служебную обвязку вики: навигацию, футер и выбор региона.
    let text = raw
      .replace(/^[\s\S]*?class="mw-content-ltr">/, '')
      .replace(/Источник — «[\s\S]*$/, '')
      .replace(/Категория:[\s\S]*$/, '');
    text = text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

    const snapshot = waybackReport?.wiki?.find((w) => w.page && file.startsWith(w.page.slice(0, 20)));
    lines.push(`## ${title}`, '');
    if (snapshot?.snapshot) lines.push(`Снимок: [${snapshot.timestamp}](${snapshot.snapshot})`, '');
    lines.push('```', text.slice(0, 12000), '```', '');
  }
  return lines.join('\n');
}

// ── Источники и пробелы ──────────────────────────────────────────────────────
function buildSources() {
  const failedAssets = assetsReport?.failed ?? [];
  const cardArtFailures = failedAssets.filter((f) => f.kind === 'card');
  const noneAbilities = coverage.unparsed.filter((x) => x.coverage === 'none');

  const lines = [
    '# Источники и пробелы',
    '',
    GENERATED,
    '',
    '## Откуда взяты данные',
    '',
    '| Источник | Что даёт | Как получено |',
    '| --- | --- | --- |',
    '| [Вики Wargaming, пространство `Card:`](https://wiki.wargaming.net/ru/Служебная:Все_страницы?namespace=10006) | ' +
      `${cards.length} карт со статами и способностями | \`tools/scrape/fetch-wiki.mjs\` |`,
    '| [Страницы «Штаб», «Техника», «Взводы», «Приказы»](https://wiki.wargaming.net/ru/Штаб) | Правила боя и перемещения | `tools/scrape/fetch-wiki.mjs` |',
    '| [«Игровые термины (WoTG)»](https://wiki.wargaming.net/ru/Игровые_термины_(WoTG)) | Глоссарий ключевых слов | `tools/scrape/fetch-wiki.mjs` |',
    '| [«Примеры колод»](https://wiki.wargaming.net/ru/Примеры_колод) | Архетипы колод | `tools/scrape/fetch-wiki.mjs` |',
    '| Энциклопедия World of Tanks, пространство `Tank:` | Класс техники для карт без описания | `tools/scrape/resolve-classes.mjs` |',
    '| `wiki.wgcdn.co` | Оригинальные арты карт и иллюстрации | `tools/scrape/fetch-assets.mjs` |',
    '| Wayback Machine (`wotgenerals.com`, удалённые страницы вики) | Официальное руководство и патчноуты | `tools/scrape/fetch-wayback.mjs` |',
    '',
    '## Полнота сбора',
    '',
    `- Страниц в пространстве \`Card:\`: **${parseReport.totalPages}**, из них перенаправлений (альтернативные и старые названия): **${parseReport.redirects}**.`,
    `- Уникальных карт разобрано: **${parseReport.parsed}**, сбоев разбора: **${parseReport.failures.length}**.`,
    `- Полей без значения после дорезолвивания: **${Object.keys(parseReport.missingFields).length === 0 ? 'нет' : JSON.stringify(parseReport.missingFields)}**.`,
    assetsReport
      ? `- Скачано изображений: **${(assetsReport.cards?.length ?? 0) + (assetsReport.ui?.length ?? 0)}** ` +
        `(артов карт ${assetsReport.cards?.length ?? 0} из ${cards.length}).`
      : '- Отчёт о загрузке изображений отсутствует.',
    '',
  ];

  lines.push('## Известные пробелы', '');

  if (cardArtFailures.length) {
    lines.push('### Карты без арта', '');
    for (const f of cardArtFailures) {
      lines.push(`- **${f.name}** — файл \`${f.file}\` на вики не загружен (ссылка «красная»).`);
    }
    lines.push('');
  }

  if (parseReport.conflicts?.length) {
    lines.push('### Противоречия в источнике', '');
    for (const c of parseReport.conflicts) {
      lines.push(
        `- **${c.title}**, поле «${c.field}»: код картинки говорит «${c.byImage}», ` +
          `описание — «${c.byDescription}», ветка — «${c.byBranch}». ` +
          `Принято значение **${c.resolved}** по большинству признаков.`,
      );
    }
    lines.push('');
  }

  lines.push(
    '### Способности, не переведённые в исполняемый вид',
    '',
    `Из ${coverage.stats.total} строк способностей движок исполняет ` +
      `${coverage.stats.full} полностью и ${coverage.stats.partial} частично; ` +
      `${coverage.stats.note} строк — пояснения, а не способности. ` +
      `Ниже ${noneAbilities.length} строк, которые движок не исполняет вовсе.`,
    '',
  );
  for (const a of noneAbilities) {
    lines.push(`- **${a.card}**: ${a.text}`);
  }
  lines.push('');

  lines.push(
    '### Что утрачено безвозвратно',
    '',
    '- Клиент игры и его ассеты (анимации, звук, интерфейс боя) не сохранились ни в одном архиве.',
    '- Точные формулы подбора соперника и полная экономика прогрессии известны лишь частично.',
    '- Официальные страницы `Свойства карт (WoTG)`, `Премиумные карты (WoTG)` и патчноуты удалены с вики',
    '  и доступны только в виде архивных снимков — часть иллюстраций в них утеряна.',
    '',
    '## Правовая заметка',
    '',
    'Арты карт, иллюстрации и названия — интеллектуальная собственность Wargaming.',
    'В этом репозитории они используются для изучения и восстановления правил игры.',
    'При публикации собственной игры их необходимо заменить: путь к изображению',
    'формируется в одном месте (`apps/web/src/data.ts`, функция `cardArtUrl`),',
    'поэтому подмена набора ассетов не затрагивает остальной код.',
    '',
  );

  return lines.join('\n');
}

// ── Запись ───────────────────────────────────────────────────────────────────
await mkdir(NATION_DIR, { recursive: true });
await writeFile(`${DOCS}/08-каталог-карт.md`, buildCatalogue(), 'utf8');
for (const nation of NATIONS) {
  await writeFile(`${NATION_DIR}/${nation.file}`, buildNation(nation), 'utf8');
}
await writeFile(`${DOCS}/05-глоссарий.md`, await buildGlossary(), 'utf8');
await writeFile(`${DOCS}/10-история-версий.md`, await buildHistory(), 'utf8');
await writeFile(`${DOCS}/12-источники.md`, buildSources(), 'utf8');

console.log('Сгенерировано:');
console.log('  docs/08-каталог-карт.md');
console.log('  docs/06-фракции/{ссср,германия,сша}.md');
console.log('  docs/05-глоссарий.md');
console.log('  docs/10-история-версий.md');
console.log('  docs/12-источники.md');
