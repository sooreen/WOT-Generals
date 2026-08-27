import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const msgs = [];
p.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
p.on('pageerror', e => msgs.push('PAGEERROR: ' + (e.stack ?? e.message)));
p.on('requestfailed', r => msgs.push('REQFAIL: ' + r.url() + ' ' + r.failure()?.errorText));

await p.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 30000 });
await p.waitForTimeout(2500);
await p.screenshot({ path: '/tmp/wotg-shots/1-menu.png' });
console.log('root innerHTML (первые 400):', (await p.locator('#root').innerHTML()).slice(0, 400));
console.log('--- сообщения ---');
console.log(msgs.slice(0, 15).join('\n') || 'нет');
await b.close();
