// Общий HTTP-слой для скрейперов.
//
// Два подтверждённых разведкой ограничения, от которых зависит вся сборка данных:
//   1. wiki.wargaming.net отдаёт 403 на «неживой» User-Agent — нужен браузерный.
//   2. Запросы надо троттлить, иначе сервер начинает резать соединения.
// Ответы кешируются на диск: повторный прогон скрейпера не бьёт по чужому серверу.

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CACHE_DIR = '.cache/http';
const DELAY_MS = 350;

let lastRequest = 0;
async function throttle() {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
}

function cachePath(url, binary) {
  const hash = createHash('sha1').update(url).digest('hex');
  return `${CACHE_DIR}/${hash.slice(0, 2)}/${hash}${binary ? '.bin' : '.txt'}`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path) {
  await mkdir(dirname(path), { recursive: true });
}

/**
 * GET с ретраями, троттлингом и дисковым кешем.
 * Возвращает { ok, status, body } — body это string или Buffer.
 * Ошибки не бросаются: вызывающий код сам решает, что делать с провалом,
 * чтобы одна недоступная страница не роняла сбор остальных 239.
 */
export async function get(url, { binary = false, retries = 3, useCache = true } = {}) {
  const cached = cachePath(url, binary);
  if (useCache && (await exists(cached))) {
    const body = binary ? await readFile(cached) : await readFile(cached, 'utf8');
    return { ok: true, status: 200, body, fromCache: true };
  }

  let lastStatus = 0;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ru,en;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(45000),
      });
      lastStatus = res.status;

      if (res.status === 404) {
        // 404 — это факт о странице, а не сбой сети. Ретраить бессмысленно.
        return { ok: false, status: 404, body: null };
      }
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }

      const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
      if (useCache) {
        await ensureDir(cached);
        await writeFile(cached, body);
      }
      return { ok: true, status: res.status, body, fromCache: false };
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  return { ok: false, status: lastStatus, body: null, error: lastError };
}

export const WIKI = 'https://wiki.wargaming.net/ru';

/** Викитекст страницы через action=raw. null, если страницы нет (удалена/не существует). */
export async function fetchRaw(title) {
  const url = `${WIKI}/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&action=raw`;
  const res = await get(url);
  return res.ok ? res.body : null;
}

/** Отрендеренный HTML страницы — нужен там, где важна разметка, а не исходник. */
export async function fetchHtml(title) {
  const url = `${WIKI}/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const res = await get(url);
  return res.ok ? res.body : null;
}

export function log(...args) {
  process.stdout.write(args.join(' ') + '\n');
}
