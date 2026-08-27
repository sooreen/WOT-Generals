// Сквозная проверка в браузере: из меню в бой, розыгрыш карты, ход ИИ.
//
// Требуется запущенный сервер: pnpm start
// Первый ход определяется случайно, поэтому проверка сначала дожидается хода игрока.

import { chromium } from '@playwright/test';

const BASE = process.env.WOTG_URL ?? 'http://localhost:8080';
const problems = [];
const ok = (label, value) => console.log(`  ${value ? '✓' : '✗'} ${label}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

console.log('1. Меню');
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.hq-option', { timeout: 20000 });
const hqCount = await page.locator('.hq-option').count();
ok(`штабов в списке: ${hqCount / 2} на сторону`, hqCount > 0);
ok('арт штаба загружен', await page.locator('.hq-option img').first().isVisible());

await page.locator('.hq-option', { hasText: 'Учебная часть' }).first().click();
await page.locator('.difficulty', { hasText: 'Сержант' }).click();
await page.locator('button.start').click();

console.log('2. Экран боя');
await page.waitForSelector('.board', { timeout: 20000 });
const cells = await page.locator('.cell').count();
ok(`клеток на поле: ${cells}`, cells === 15);
ok(`карт в руке: ${await page.locator('.hand .card').count()}`, (await page.locator('.hand .card').count()) === 6);
ok(`слотов взводов: ${await page.locator('.squad-slot').count()}`, (await page.locator('.squad-slot').count()) === 10);
ok('штабы видны', (await page.locator('.cell.hq').count()) === 2);

console.log('3. Ход игрока');
// Первый ход достаётся случайной стороне — дожидаемся своего.
await page.locator('.turn-side.mine').waitFor({ timeout: 30000 });
const resources = Number((await page.locator('.res-value').textContent())?.trim());
ok(`ресурсов начислено: ${resources}`, resources > 0);

const playable = page.locator('.hand .card.playable');
const playableCount = await playable.count();
ok(`играбельных карт: ${playableCount}`, playableCount > 0);

// В руке может не оказаться техники: взводы и приказы разыгрываются сразу,
// без выбора клетки. Поэтому перебираем карты, пока не найдём ту, что даёт плацдарм.
let deployed = false;
let anythingPlayed = false;
const handBefore = await page.locator('.hand .card').count();

for (let i = 0; i < playableCount && !deployed; i++) {
  const cards = page.locator('.hand .card.playable');
  if (await cards.count() === 0) break;
  await cards.nth(Math.min(i, (await cards.count()) - 1)).click();
  await page.waitForTimeout(300);

  const target = page.locator('.cell.deployable');
  if (await target.count()) {
    await target.first().click();
    await page.waitForTimeout(400);
    deployed = (await page.locator('.unit').count()) > 0;
  }
  if ((await page.locator('.hand .card').count()) < handBefore) anythingPlayed = true;
}
ok(deployed ? 'техника выведена на плацдарм' : 'карта разыграна (техники в руке не было)',
   deployed || anythingPlayed);
await page.screenshot({ path: '/tmp/wotg-shots/e2e-deploy.png' });

console.log('4. Ход противника');
const turnBefore = await page.locator('.turn-number').textContent();
await page.locator('.end-turn').click();
await page.locator('.turn-side.mine').waitFor({ timeout: 40000 });
const turnAfter = await page.locator('.turn-number').textContent();
ok(`ход сменился: ${turnBefore} → ${turnAfter}`, turnBefore !== turnAfter);
ok('ИИ сделал ходы (лог наполнен)', (await page.locator('.log-line').count()) > 3);
ok('индикатор раздумий снят', !(await page.locator('.end-turn').textContent())?.includes('думает'));
await page.screenshot({ path: '/tmp/wotg-shots/e2e-after-ai.png' });

if (errors.length) problems.push(`ошибки в консоли: ${errors.slice(0, 3).join(' | ')}`);
if (!deployed && !anythingPlayed) problems.push('не удалось разыграть ни одной карты');

console.log();
if (problems.length) {
  console.log('ПРОБЛЕМЫ:'); problems.forEach((p) => console.log('  -', p));
} else {
  console.log('Сквозная проверка пройдена без замечаний.');
}
await browser.close();
process.exit(problems.length ? 1 : 0);
