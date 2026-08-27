// Сборка data/abilities.json: текстовые способности карт → исполняемый DSL.
// Печатает отчёт покрытия — какая доля способностей действительно исполняема движком.

import { readFile, writeFile } from 'node:fs/promises';
import { translateAbility, KEYWORD_RU } from './lib/abilities-dsl.mjs';

const cards = JSON.parse(await readFile('data/cards.json', 'utf8'));

const out = {};
const stats = { full: 0, partial: 0, note: 0, none: 0, total: 0 };
const unparsed = [];

for (const card of cards) {
  const translated = card.abilities.map((text) => translateAbility(text, card.nation));
  if (!translated.length) continue;

  out[card.name] = translated;
  for (const t of translated) {
    stats.total++;
    stats[t.coverage]++;
    if (t.coverage !== 'full' && t.coverage !== 'note') {
      unparsed.push({ card: card.name, coverage: t.coverage, text: t.raw });
    }
  }
}

// Ключевые свойства выносим отдельным индексом: движок проверяет их постоянно,
// и удобнее иметь готовый список, а не искать по предложениям DSL на каждом шаге.
const keywordIndex = {};
for (const [name, list] of Object.entries(out)) {
  for (const t of list) {
    for (const c of t.clauses) {
      if (c.op !== 'keyword') continue;
      (keywordIndex[name] ??= []).push({ keyword: c.keyword, condition: t.condition ?? null });
    }
  }
}

await writeFile(
  'data/abilities.json',
  JSON.stringify({ abilities: out, keywordIndex, keywordNames: KEYWORD_RU }, null, 2),
  'utf8',
);
await writeFile('data/abilities-coverage.json', JSON.stringify({ stats, unparsed }, null, 2), 'utf8');

const pct = (n) => `${((n / stats.total) * 100).toFixed(1)}%`;
console.log(`способностей всего: ${stats.total}`);
console.log(`  полностью исполнимы: ${stats.full} (${pct(stats.full)})`);
console.log(`  частично:            ${stats.partial} (${pct(stats.partial)})`);
console.log(`  пояснения (не способности): ${stats.note} (${pct(stats.note)})`);
console.log(`  не разобрано:        ${stats.none} (${pct(stats.none)})`);
const executable = stats.full + stats.partial;
const relevant = stats.total - stats.note;
console.log(`исполнимо от значимых: ${executable}/${relevant} (${((executable / relevant) * 100).toFixed(1)}%)`);
console.log(`карт с ключевыми свойствами: ${Object.keys(keywordIndex).length}`);
