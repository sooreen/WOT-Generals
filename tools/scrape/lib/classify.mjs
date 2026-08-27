// Вывод нации, типа и класса карты.
//
// В шаблоне {{Wotg Card}} нет полей «нация» и «класс техники» — их приходится
// восстанавливать из двух независимых источников:
//   1. код картинки вида {нация}{тип}_{имя}: gv_e_50 → Германия, техника;
//   2. текст описания: «немецкая премиумная ПТ-САУ 7 уровня».
// Источники сверяются между собой, расхождения возвращаются наружу как конфликты,
// а не молча замазываются.

export const NATIONS = { g: 'germany', u: 'usa', s: 'ussr' };
export const KINDS = { v: 'vehicle', h: 'hq', p: 'platoon', o: 'order' };

export const NATION_RU = { germany: 'Германия', usa: 'США', ussr: 'СССР' };

/** Из кода картинки «gv_e_50» / «uv t25slash2» → { nation, kind, slug }. */
export function fromImageCode(code) {
  if (!code) return {};
  const m = String(code).trim().match(/^([gus])([vhpo])[_\s]+(.*)$/i);
  if (!m) return {};
  return {
    nation: NATIONS[m[1].toLowerCase()],
    kind: KINDS[m[2].toLowerCase()],
    slug: m[3].trim().replace(/\s+/g, '_'),
  };
}

// Классы техники. Порядок важен: «ПТ-САУ» должна проверяться раньше «САУ».
// Внимание: \w в JavaScript — это [A-Za-z0-9_], кириллицу он НЕ покрывает,
// поэтому во всех правилах ниже окончания слов задаются явным классом Б.
const Б = '[а-яёa-z]*';
const VEHICLE_CLASSES = [
  [/пт-?\s?сау/i, 'td'],
  [new RegExp(`сау|самоходн${Б}\\s+артиллерийск`, 'i'), 'spg'],
  [new RegExp(`тяж[её]л${Б}\\s+танк`, 'i'), 'heavy'],
  [new RegExp(`средн${Б}\\s+танк`, 'i'), 'medium'],
  [new RegExp(`л[её]гк${Б}\\s+танк`, 'i'), 'light'],
];

export const VEHICLE_CLASS_RU = {
  light: 'Лёгкий танк',
  medium: 'Средний танк',
  heavy: 'Тяжёлый танк',
  td: 'ПТ-САУ',
  spg: 'САУ',
};

// Между словом-типом и «штаб» вики иногда вставляет уточнения:
// «сводный премиум-штаб», «американский, ударный штаб». Допускаем до двух слов.
const МЕЖ = '[\\s,-]*(?:[а-яёa-z-]+[\\s-]+){0,2}';
const HQ_TYPES = [
  [new RegExp(`учебн${Б}${МЕЖ}(штаб|часть|лагер)`, 'i'), 'training'],
  [new RegExp(`ударн${Б}${МЕЖ}штаб`, 'i'), 'strike'],
  [new RegExp(`сводн${Б}${МЕЖ}штаб`, 'i'), 'combined'],
  [new RegExp(`тылов${Б}${МЕЖ}штаб`, 'i'), 'rear'],
  // Опечатка редактора вики: «свободный штаб» вместо «сводный».
  [new RegExp(`свободн${Б}${МЕЖ}штаб`, 'i'), 'combined'],
];

export const HQ_TYPE_RU = {
  training: 'Учебный',
  strike: 'Ударный',
  combined: 'Сводный',
  rear: 'Тыловой',
};

const PLATOON_SPECS = [
  [/разведк|разведчик|разведывательн|разведыват|recon|scout|cavalry/i, 'recon'],
  [/связ(и|ист)|телеграфист|телефонист|telephonist|telegraph|signal|radio/i, 'signals'],
  [/артиллерист|мином[её]тчик|артиллерийск|mortar|artiller|airdefense|air defense/i, 'artillery'],
  [/медик|врач|санитар|медицинск|medic|hospital|surgeon/i, 'medics'],
  [/инженер|ремонтник|сап[её]рн|engineer|sapper|pioneer|repair/i, 'engineers'],
];

export const PLATOON_SPEC_RU = {
  recon: 'Разведчики',
  signals: 'Связисты',
  artillery: 'Артиллеристы',
  medics: 'Медики',
  engineers: 'Инженеры',
};

const NATION_WORDS = [
  [/немецк|герман/i, 'germany'],
  [/американск|сша/i, 'usa'],
  [/советск|ссср/i, 'ussr'],
];

function firstMatch(table, text) {
  for (const [re, value] of table) if (re.test(text)) return value;
  return null;
}

/**
 * Разбирает описание карты. Описание всегда начинается формулой вида
 * «<Имя> — <нация> <класс> <N> уровня», поэтому смотрим только первое предложение:
 * дальше идёт вольный текст обзора, где слова «тяжёлый танк» могут относиться к чужой карте.
 */
export function fromDescription(description) {
  if (!description) return {};
  const head = description.split(/<br|\n|\.\s/)[0];
  return {
    nation: firstMatch(NATION_WORDS, head),
    vehicleClass: firstMatch(VEHICLE_CLASSES, head),
    hqType: firstMatch(HQ_TYPES, head),
    platoonSpec: firstMatch(PLATOON_SPECS, head),
    premium: /премиум/i.test(head) || null,
  };
}
