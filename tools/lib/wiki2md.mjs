// Преобразование викитекста страниц Wargaming в Markdown.
// Нужно, чтобы разделы документации, взятые с вики, не переписывались вручную
// и не расходились с источником при повторном сборе данных.

/** Ссылки на файлы превращаем в ссылки на локальные копии изображений. */
function fileLink(name) {
  const clean = name.trim().replace(/\s+/g, '_');
  const upper = clean.charAt(0).toUpperCase() + clean.slice(1);
  return `![${name.trim()}](../data/assets/ui/${upper})`;
}

export function wikiToMarkdown(text, { imageBase = '../data/assets/ui' } = {}) {
  let s = text;

  // Служебные обёртки и HTML-комментарии.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\/?(noinclude|includeonly|onlyinclude)>/g, '');
  s = s.replace(/__[A-ZА-Я]+__/g, '');

  // Блоки-подсказки {{Блок| ! | content = ...}} → цитата.
  s = s.replace(/\{\{Блок\|\s*[!i?]\s*\|\s*content\s*=\s*([\s\S]*?)\}\}/g, (_, body) =>
    body.split('\n').map((l) => `> ${l.trim()}`).join('\n'));

  // Изображения.
  s = s.replace(/\[\[(?:Файл|File|Изображение):([^|\]]+)(\|[^\]]*)?\]\]/g, (_, name) => {
    const clean = name.trim().replace(/\s+/g, '_');
    const upper = clean.charAt(0).toUpperCase() + clean.slice(1);
    return `![${name.trim()}](${imageBase}/${upper})`;
  });

  // Ссылки на карты и страницы вики.
  s = s.replace(/\[\[Card:([^\]|]+)\|([^\]]+)\]\]/g, '**$2**');
  s = s.replace(/\[\[Card:([^\]]+)\]\]/g, '**$1**');
  s = s.replace(/\[\[([^\]|#]+)#[^\]|]*\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/\[(https?:\/\/\S+)\s+([^\]]+)\]/g, '[$2]($1)');

  // Заголовки: на вики верхний уровень — ===, в документе он должен быть ##.
  s = s.replace(/^======\s*(.+?)\s*======$/gm, '##### $1');
  s = s.replace(/^=====\s*(.+?)\s*=====$/gm, '#### $1');
  s = s.replace(/^====\s*(.+?)\s*====$/gm, '#### $1');
  s = s.replace(/^===\s*(.+?)\s*===$/gm, '### $1');
  s = s.replace(/^==\s*(.+?)\s*==$/gm, '## $1');

  // Таблицы вики → таблицы Markdown.
  s = s.replace(/\{\|[^\n]*\n([\s\S]*?)\n\|\}/g, (_, body) => wikiTable(body));

  // Форматирование и остатки шаблонов.
  s = s.replace(/'''([^']+)'''/g, '**$1**');
  s = s.replace(/''([^']+)''/g, '*$1*');
  s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/<br\s*\/?>/gi, '  \n');
  s = s.replace(/<\/?(div|center|span|noinclude)[^>]*>/gi, '');

  s = s.replace(/[ \t]+$/gm, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Тело вики-таблицы (между {| и |}) → Markdown-таблица. */
function wikiTable(body) {
  const rows = [];
  let current = null;
  let headerRow = null;

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('|-')) {
      if (current) rows.push(current);
      current = [];
      continue;
    }
    if (line.startsWith('!')) {
      const cells = line.slice(1).split('!!').map((c) => c.trim());
      headerRow = (headerRow ?? []).concat(cells);
      continue;
    }
    if (line.startsWith('|')) {
      const cells = line.slice(1).split('||').map((c) => c.trim());
      current = (current ?? []).concat(cells);
    }
  }
  if (current?.length) rows.push(current);

  const clean = (c) =>
    c.replace(/^\s*style\s*=\s*"[^"]*"\s*\|/, '')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ')
      .trim();

  const width = Math.max(headerRow?.length ?? 0, ...rows.map((r) => r.length), 1);
  const header = headerRow?.length ? headerRow : Array.from({ length: width }, () => ' ');

  const out = [
    `| ${header.map(clean).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.filter((r) => r.length).map((r) => `| ${r.map(clean).join(' | ')} |`),
  ];
  return '\n' + out.join('\n') + '\n';
}

export { fileLink };
