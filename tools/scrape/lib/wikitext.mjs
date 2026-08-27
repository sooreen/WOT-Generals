// Разбор викитекста шаблона {{Wotg Card}}.
//
// Наивный split('|') здесь не работает: значения полей содержат вложенные
// шаблоны ({{...}}), вики-ссылки ([[...]]) и таблицы, внутри которых тоже есть '|'.
// Поэтому режем параметры только на нулевой глубине вложенности.

/** Находит тело шаблона по имени и возвращает содержимое между {{Имя и парной }}. */
export function extractTemplate(text, name) {
  const start = text.indexOf(`{{${name}`);
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    if (pair === '{{') {
      depth++;
      i++;
    } else if (pair === '}}') {
      depth--;
      i++;
      if (depth === 0) return text.slice(start + 2 + name.length, i - 1);
    }
  }
  return null;
}

/** Режет тело шаблона на параметры «ключ = значение», уважая вложенность. */
export function parseParams(body) {
  const parts = [];
  let depth = 0;
  let buf = '';

  for (let i = 0; i < body.length; i++) {
    const pair = body.slice(i, i + 2);
    if (pair === '{{' || pair === '[[') {
      depth++;
      buf += pair;
      i++;
      continue;
    }
    if (pair === '}}' || pair === ']]') {
      depth--;
      buf += pair;
      i++;
      continue;
    }
    if (body[i] === '|' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += body[i];
  }
  parts.push(buf);

  const out = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key) out[key] = part.slice(eq + 1);
  }
  return out;
}

/** Убирает HTML-комментарии — в шаблоне ими помечены подсказки редактору. */
export function stripComments(value) {
  return value.replace(/<!--[\s\S]*?-->/g, '');
}

/** Значение поля: без комментариев, с нормализованными пробелами. Пустое → null. */
export function cleanValue(value) {
  if (value == null) return null;
  const v = stripComments(value).trim();
  return v === '' ? null : v;
}

/** Число из поля. Допускает «22 400», «2 620» с неразрывными пробелами. */
export function toNumber(value) {
  const v = cleanValue(value);
  if (v == null) return null;
  const digits = v.replace(/[\s  ]/g, '');
  if (!/^-?\d+$/.test(digits)) return null;
  return Number(digits);
}

/** Викиразметку → читаемый текст (для описаний и способностей). */
export function wikiToPlain(value) {
  if (value == null) return null;
  let v = stripComments(value);
  v = v.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1'); // [[Ссылка|текст]] → текст
  v = v.replace(/\[\[([^\]]*)\]\]/g, '$1'); // [[текст]] → текст
  v = v.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1'); // [url текст] → текст
  v = v.replace(/'''([^']*)'''/g, '$1'); // жирный
  v = v.replace(/''([^']*)''/g, '$1'); // курсив
  v = v.replace(/<br\s*\/?>/gi, '\n');
  v = v.replace(/<[^>]+>/g, '');
  v = v.replace(/\{\{[^}]*\}\}/g, '');
  v = v.replace(/[ \t]+/g, ' ');
  v = v.replace(/\n{3,}/g, '\n\n');
  return v.trim() || null;
}

/** Список способностей: строки, начинающиеся с '*' или '#'. */
export function parseAbilities(value) {
  const plain = stripComments(value ?? '');
  const out = [];
  for (const rawLine of plain.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^[*#]+\s*(.*)$/);
    const text = wikiToPlain(m ? m[1] : line);
    if (text) out.push(text);
  }
  return out;
}

/**
 * Стат карты. На вики встречаются два расширенных формата, и оба несут игровой смысл:
 *   «6/10»  — базовое значение / значение с учётом национальной или штабной способности
 *             (Объект 261: «Прочность = 6/10» + способность «+4 к прочности на штабах СССР»);
 *   «6(К)»  — уровень карты плюс метка способности «Конвейер» (до 10 копий в колоде).
 * Возвращает { base, boosted, conveyor }, где boosted = null, если второго значения нет.
 */
export function parseStat(value) {
  const v = cleanValue(value);
  if (v == null) return { base: null, boosted: null, conveyor: false };

  const conveyor = /\(\s*[КK]\s*\)/.test(v);
  const cleaned = v.replace(/\(\s*[КK]\s*\)/g, '').replace(/[\s  ]/g, '');

  const pair = cleaned.match(/^(-?\d+)\/(-?\d+)$/);
  if (pair) return { base: Number(pair[1]), boosted: Number(pair[2]), conveyor };

  const single = cleaned.match(/^(-?\d+)$/);
  if (single) return { base: Number(single[1]), boosted: null, conveyor };

  return { base: null, boosted: null, conveyor };
}
