// Перевод текстовых способностей карт в исполняемый DSL.
//
// Способности на вики записаны обычным русским языком и в очень разной форме:
//   «Маскировка (на штабах СССР)», «(только для советских штабов) Подкрепления.»,
//   «Национальная особенность: +3 к прочности.», «Когда выходит на поле боя — ...».
// Разбор идёт в два шага: сначала из текста вынимается условие (нация/тип штаба),
// затем оставшееся тело сопоставляется с таблицей правил.
//
// Всё, что не удалось разобрать, помечается coverage: 'none' и остаётся в данных
// как исходный текст — движок такие способности не исполняет, а документация
// показывает их отдельным списком. Молча терять способности нельзя.

/** Семь ключевых свойств из официального руководства (Attributes of Cards). */
export const KEYWORDS = {
  'арьергард': 'rearguard',       // розыгрыш за 0, если карта последняя в руке
  'арьегард': 'rearguard',        // частая опечатка в текстах вики
  'блиц': 'blitz',                // оплата случайными картами из колоды вместо ресурсов
  'конвейер': 'massProduction',   // копий в колоде = уровень штаба + 3
  'маскировка': 'camouflage',     // не может быть атакована штабом и САУ
  'охранение': 'guard',           // принимает на себя урон по штабу, находясь на плацдарме
  'прикрытие': 'cover',           // не получает контратак
  'подкрепления': 'reinforcements', // при розыгрыше — дополнительная карта в руку
};

export const KEYWORD_RU = {
  rearguard: 'Арьергард',
  blitz: 'Блиц',
  massProduction: 'Конвейер',
  camouflage: 'Маскировка',
  guard: 'Охранение',
  cover: 'Прикрытие',
  reinforcements: 'Подкрепления',
};

const NATION_COND = [
  [/советск|ссср/i, 'ussr'],
  [/немецк|герман/i, 'germany'],
  [/американск|сша/i, 'usa'],
];

const HQTYPE_COND = [
  [/ударн/i, 'strike'],
  [/сводн/i, 'combined'],
  [/тылов/i, 'rear'],
  [/учебн/i, 'training'],
];

const STAT_WORDS = [
  [/прочност/i, 'hp'],
  [/огнев\S*\s+мощ|атак[еи]\b/i, 'attack'],
  [/прирост\S*\s+ресурс|приросту?\b/i, 'income'],
  [/стоимост/i, 'cost'],
  [/поддержк/i, 'support'], // сила взвода: прибавка к атаке штаба или поглощение урона
];

function matchTable(table, text) {
  for (const [re, value] of table) if (re.test(text)) return value;
  return null;
}

/**
 * Вынимает из текста условие применения и возвращает очищенное тело.
 * Условие может стоять и перед эффектом, и в скобках после него, и в виде
 * служебного префикса «Национальная особенность:» / «Способность активная на …:».
 */
export function extractCondition(text, cardNation) {
  let body = text;
  const condition = {};

  // «Национальная особенность: X» — работает, если штаб той же нации, что и карта.
  const national = body.match(/^\s*национальн\S*\s+(?:особенность|способность)\s*:?\s*/i);
  if (national) {
    body = body.slice(national[0].length);
    if (cardNation) condition.hqNation = cardNation;
  }

  // «Способность активная на ударных штабах: X»
  // «только» может стоять и между «активная» и «на» — учитываем.
  const activeOn = body.match(/^\s*способность\s+активн\S*\s+(?:только\s+)?на\s+([^:.]+?)\s*[:.]\s*/i);
  if (activeOn) {
    const t = matchTable(HQTYPE_COND, activeOn[1]);
    const n = matchTable(NATION_COND, activeOn[1]);
    if (t) condition.hqType = t;
    if (n) condition.hqNation = n;
    body = body.slice(activeOn[0].length);
  }

  // Скобочные и вводные пометки: «(на штабах СССР)», «(только для немецких штабов)».
  const paren = /\((?:только\s+)?(?:для\s+|на\s+)?([^)]*штаб[^)]*)\)/gi;
  body = body.replace(paren, (_, inner) => {
    const t = matchTable(HQTYPE_COND, inner);
    const n = matchTable(NATION_COND, inner);
    if (t) condition.hqType = t;
    if (n) condition.hqNation = n;
    return ' ';
  });

  // Префикс «Для немецких штабов: …» — та же связка условия и эффекта.
  const forHq = body.match(/^\s*для\s+([^:]*штаб\S*)\s*:\s*/i);
  if (forHq) {
    const t = matchTable(HQTYPE_COND, forHq[1]);
    const n = matchTable(NATION_COND, forHq[1]);
    if (t) condition.hqType = t;
    if (n) condition.hqNation = n;
    body = body.slice(forHq[0].length);
  }

  // Бесскобочный префикс: «только для советских штабов Подкрепления».
  const bare = body.match(/^\s*только\s+для\s+([^,.]*штаб\S*)\s*[,.]?\s*/i);
  if (bare) {
    const t = matchTable(HQTYPE_COND, bare[1]);
    const n = matchTable(NATION_COND, bare[1]);
    if (t) condition.hqType = t;
    if (n) condition.hqNation = n;
    body = body.slice(bare[0].length);
  }

  // Ведущее тире срезаем только когда это разделитель, а не знак числа:
  // иначе «-4 к приросту» превращается в «4 к приросту» и меняет смысл на обратный.
  body = body
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s—–]+/, '')
    .replace(/^-(?!\d)/, '')
    .replace(/[\s.;]+$/, '')
    .trim();
  return { condition: Object.keys(condition).length ? condition : null, body };
}

// ─── Таблица правил: тело способности → предложения DSL ───────────────────────
//
// Порядок важен: более специфичные правила стоят раньше общих.

const RULES = [
  // Чистое ключевое свойство: «Маскировка», «Прикрытие.», «Блиц»
  {
    re: /^[«"']?\s*(арьергард|арьегард|блиц|конвейер|маскировка|охранение|прикрытие|подкрепления)\s*[»"']?\s*[.!]?$/i,
    build: (m) => [{ op: 'keyword', keyword: KEYWORDS[m[1].toLowerCase()] }],
  },

  // Модификатор стата с масштабом: «+1 к огневой мощи за каждую из других ваших САУ»
  {
    re: /^([+-]\s*\d+)\s*к\s+([^,.]*?)\s+за\s+кажд\S*\s+(.+)$/i,
    build: (m) => {
      const stat = matchTable(STAT_WORDS, m[2]);
      if (!stat) return null;
      return [{
        op: 'statBonus',
        stat,
        amount: Number(m[1].replace(/\s/g, '')),
        per: { description: m[3].trim() },
        partial: true, // условие подсчёта разобрано как текст, а не как предикат
      }];
    },
  },

  // Простой модификатор стата: «+3 к прочности», «+2 к приросту ресурсов»
  {
    re: /^([+-]\s*\d+)\s*к\s+(.+)$/i,
    build: (m) => {
      const stat = matchTable(STAT_WORDS, m[2]);
      if (!stat) return null;
      return [{ op: 'statBonus', stat, amount: Number(m[1].replace(/\s/g, '')) }];
    },
  },

  // Снижение стоимости за каждый объект: «Стоимость уменьшается на 2 за каждую технику …»
  {
    re: /^стоимость\s+уменьшается\s+на\s+(\d+)\s+за\s+кажд\S*\s+(.+)$/i,
    build: (m) => [{
      op: 'costReduction',
      amount: Number(m[1]),
      per: { description: m[2].trim() },
      partial: true,
    }],
  },

  // Триггеры выхода на поле: «Когда выходит на поле боя — <эффект>», «Когда разыграна — …»
  {
    re: /^когда\s+(?:выходит\s+на\s+поле\s+боя|разыграна?|разыгрывается)\s*[—–\-:,]\s*(.+)$/i,
    build: (m) => [{ op: 'trigger', on: 'deploy', effects: parseEffects(m[1]) }],
  },

  // «Когда уничтожается техника противника — …» / «Когда уничтожена вражеская техника …»
  {
    re: /^когда\s+(?:в\s+ваш\s+ход\s+)?уничтожа\S*\s+(?:вражеск\S*\s+техник\S*|техника\s+противника)\s*[—–\-:,]\s*(.+)$/i,
    build: (m) => [{ op: 'trigger', on: 'enemyVehicleDestroyed', effects: parseEffects(m[1]) }],
  },

  // «Когда уничтожен — …» (о самой карте)
  {
    re: /^когда\s+уничтожен\S*\s*[—–\-:,]\s*(.+)$/i,
    build: (m) => [{ op: 'trigger', on: 'selfDestroyed', effects: parseEffects(m[1]) }],
  },

  // «Когда атакует <кого> — наносит на N повреждений больше»
  {
    re: /^когда\s+атакует\s+(.+?)\s*[—–\-:,]?\s*наносит\s+на\s+(\d+)\s+повреждени\S*\s+больше\s*\.?$/i,
    build: (m) => [{
      op: 'trigger',
      on: 'attack',
      condition: { targetDescription: m[1].trim() },
      effects: [{ op: 'bonusDamage', amount: Number(m[2]) }],
      partial: true, // цель описана текстом
    }],
  },

  // «Когда атакует — <эффект>»
  {
    re: /^когда\s+(?:\S+\s+)?атакует\s*[—–\-:,]\s*(.+)$/i,
    build: (m) => [{ op: 'trigger', on: 'attack', effects: parseEffects(m[1]) }],
  },

  // «После атаки — <эффект>»
  {
    re: /^после\s+атаки\s*[—–\-:,]?\s*(.+)$/i,
    build: (m) => [{ op: 'trigger', on: 'afterAttack', effects: parseEffects(m[1]) }],
  },

  // «Когда <карта> контратакует — <эффект>»
  {
    re: /^когда\s+(?:\S+\s+)*?контратакует\s*[—–\-:,]\s*(.+)$/i,
    build: (m) => [{ op: 'trigger', on: 'counterattack', effects: parseEffects(m[1]) }],
  },

  // «Когда получает повреждения — <эффект>»
  {
    re: /^когда\s+получает\s+повреждени\S*\s*[—–\-:,]\s*(.+)$/i,
    build: (m) => [{ op: 'trigger', on: 'damaged', effects: parseEffects(m[1]) }],
  },

  // «Когда ваш штаб наносит повреждения штабу противника — <эффект>»
  {
    re: /^когда\s+ваш\s+штаб\s+наносит\s+повреждени\S*\s+штабу\s+противника\s*[—–\-:,]\s*(.+)$/i,
    build: (m) => [{ op: 'trigger', on: 'hqDealtDamageToEnemyHQ', effects: parseEffects(m[1]) }],
  },

  // «Не может перемещаться» — постоянное ограничение самой карты.
  {
    re: /^не\s+может\s+перемещаться\s*\.?$/i,
    build: () => [{ op: 'keyword', keyword: 'immobile' }],
  },

  // «Пока <условие> — <эффект>»: длящийся эффект с условием.
  {
    re: /^пока\s+(.+?)\s*[—–\-,]\s*(.+)$/i,
    build: (m) => [{
      op: 'whileCondition',
      condition: { description: m[1].trim() },
      effects: parseEffects(m[2]),
      partial: true, // условие оставлено текстом
    }],
  },

  // «В начале вашего хода — <эффект>» / «В конце вашего хода — <эффект>»
  {
    re: /^в\s+начале\s+(?:вашего\s+)?хода\s*[—–\-:,]?\s*(.+)$/i,
    build: (m) => [{ op: 'trigger', on: 'turnStart', effects: parseEffects(m[1]) }],
  },
  {
    re: /^в\s+конце\s+(?:вашего\s+)?хода\s*[—–\-:,]?\s*(.+)$/i,
    build: (m) => [{ op: 'trigger', on: 'turnEnd', effects: parseEffects(m[1]) }],
  },
];

// ─── Разбор самих эффектов ────────────────────────────────────────────────────

const EFFECT_RULES = [
  // «нанесите N повреждений штабу противника»
  {
    re: /нанесите\s+(\d+)\s+повреждени\S*\s+штабу\s+противника/i,
    build: (m) => ({ op: 'damage', target: 'enemyHQ', amount: Number(m[1]) }),
  },
  // «нанесите N повреждений своему штабу»
  {
    re: /нанесите\s+(\d+)\s+повреждени\S*\s+(?:своему|вашему)\s+штабу/i,
    build: (m) => ({ op: 'damage', target: 'ownHQ', amount: Number(m[1]) }),
  },
  // «восстановите N прочности вашему штабу»
  {
    re: /восстановите\s+(\d+)\s+(?:единиц\S*\s+)?прочности\s+(?:вашему|своему)\s+штабу/i,
    build: (m) => ({ op: 'heal', target: 'ownHQ', amount: Number(m[1]) }),
  },
  // «восстановите N прочности этому танку/взводу»
  {
    re: /восстановите\s+(\d+)\s+(?:единиц\S*\s+)?прочности\s+этому/i,
    build: (m) => ({ op: 'heal', target: 'self', amount: Number(m[1]) }),
  },
  // «вашему штабу восстанавливается N прочности» — пассивная форма того же лечения
  {
    re: /(?:вашему|своему)\s+штабу\s+восстанавливается\s+(\d+)\s+прочности/i,
    build: (m) => ({ op: 'heal', target: 'ownHQ', amount: Number(m[1]) }),
  },
  // «этот взвод/танк уничтожается» — карта уничтожает сама себя
  {
    re: /эт(?:от|а)\s+(?:взвод|танк|карта)\s+уничтожается/i,
    build: () => ({ op: 'destroy', target: 'self' }),
  },
  // «ваш штаб получает способность X»
  {
    re: /ваш\s+штаб\s+получает\s+(?:способность|свойство)\s+(маскировк\S*|охранени\S*|прикрыти\S*)/i,
    build: (m) => ({
      op: 'grantKeyword',
      keyword: /маскиров/i.test(m[1]) ? 'camouflage' : /охранени/i.test(m[1]) ? 'guard' : 'cover',
      target: 'ownHQ',
    }),
  },
  // «техника противника теряет свойство X»
  {
    re: /(?:техника|карты)\s+противника\s+теря\S*\s+свойство\s+(маскировк\S*|охранени\S*|прикрыти\S*)/i,
    build: (m) => ({
      op: 'removeKeyword',
      keyword: /маскиров/i.test(m[1]) ? 'camouflage' : /охранени/i.test(m[1]) ? 'guard' : 'cover',
      target: 'enemyVehicles',
    }),
  },
  // «возьмите карту»
  { re: /возьмите\s+карту/i, build: () => ({ op: 'draw', amount: 1 }) },
  // «противник перемещает N случайных карт из своей колоды в потери»
  {
    re: /противник\s+перемещает\s+(\d+)\s+случайн\S*\s+карт\S*\s+из\s+своей\s+колоды\s+в\s+потери/i,
    build: (m) => ({ op: 'mill', target: 'enemy', amount: Number(m[1]) }),
  },
  // «переместите N случайных карт из потерь в колоду»
  {
    re: /перемест\S*\s+(?:одну|\d+)\s+случайн\S*\s+карт\S*\s+из\s+потерь\s+в\s+колоду/i,
    build: (m) => ({ op: 'recoverFromCasualties', amount: 1 }),
  },
  // «замешайте N карт из ваших потерь в колоду»
  {
    re: /замешайте\s+(\d+)\s+карт\S*\s+из\s+(?:ваших\s+)?потерь\s+в\s+колоду/i,
    build: (m) => ({ op: 'recoverFromCasualties', amount: Number(m[1]) }),
  },
  // «карты противника теряют свойство Маскировка»
  {
    re: /терял?ю?т\S*\s+свойство\s+(маскировк\S*|охранени\S*|прикрыти\S*)/i,
    build: (m) => ({
      op: 'removeKeyword',
      keyword: KEYWORDS[m[1].toLowerCase().replace(/(а|е|ю|и)$/, 'а').replace('охранена', 'охранение')] ??
        (/маскиров/i.test(m[1]) ? 'camouflage' : /охранени/i.test(m[1]) ? 'guard' : 'cover'),
      target: 'enemyVehicles',
    }),
  },
  // «получает +N к огневой мощи»
  {
    re: /получает?\s+\+(\d+)\s+к\s+огнев\S*\s+мощ/i,
    build: (m) => ({ op: 'statBonus', stat: 'attack', amount: Number(m[1]), target: 'self' }),
  },
  // «получает +N к приросту ресурсов»
  {
    re: /получает?\s+\+(\d+)\s+к\s+приросту/i,
    build: (m) => ({ op: 'statBonus', stat: 'income', amount: Number(m[1]), target: 'self' }),
  },
  // «восстановите N прочности выбранной технике/штабу»
  {
    re: /восстановите\s+(\d+)\s+(?:единиц\S*\s+)?прочности\s+выбранн/i,
    build: (m) => ({ op: 'heal', target: 'chosen', amount: Number(m[1]) }),
  },
  // «нанесите N повреждений выбранной технике»
  {
    re: /нанесите\s+(\d+)\s+повреждени\S*\s+выбранн\S*\s+техник/i,
    build: (m) => ({ op: 'damage', target: 'chosenVehicle', amount: Number(m[1]) }),
  },
  // «нанесите N повреждений всей технике противника»
  {
    re: /нанесите\s+(\d+)\s+повреждени\S*\s+(?:всей?\s+)?(?:технике|картам)\s+противника/i,
    build: (m) => ({ op: 'damage', target: 'allEnemyVehicles', amount: Number(m[1]) }),
  },
  // «уничтожьте эту технику»
  {
    re: /уничтожьте\s+(?:эту\s+)?техник/i,
    build: () => ({ op: 'destroy', target: 'chosenVehicle' }),
  },
  // «не может контратаковать»
  {
    re: /не\s+мож(?:ет|но)\s+контратаковать/i,
    build: () => ({ op: 'denyCounterattack', target: 'attacked' }),
  },
  // «не может перемещаться»
  {
    re: /не\s+мож(?:ет|но)\s+перемещаться/i,
    build: () => ({ op: 'denyMove', target: 'attacked' }),
  },
  // «получает свойство X» / «получает свойства X и Y»
  {
    re: /получает\s+свойств[оа]?\s+[«"']?(маскировк\S*|охранени\S*|прикрыти\S*)/i,
    build: (m) => ({
      op: 'grantKeyword',
      keyword: /маскиров/i.test(m[1]) ? 'camouflage' : /охранени/i.test(m[1]) ? 'guard' : 'cover',
      target: 'self',
    }),
  },
  // «утрачивает свойство X»
  {
    re: /утрачивает\s+(?:свойство|способность)\s+(маскировк\S*|охранени\S*|прикрыти\S*)/i,
    build: (m) => ({
      op: 'removeKeyword',
      keyword: /маскиров/i.test(m[1]) ? 'camouflage' : /охранени/i.test(m[1]) ? 'guard' : 'cover',
      target: 'chosenVehicle',
    }),
  },
  // «получает на N повреждений меньше/больше»
  {
    re: /получа\S*\s+на\s+(\d+)\s+повреждени\S*\s+(меньше|больше)/i,
    build: (m) => ({
      op: 'damageModifier',
      amount: (m[2].toLowerCase() === 'меньше' ? -1 : 1) * Number(m[1]),
      target: 'self',
    }),
  },
  // «наносит на N повреждений больше»
  {
    re: /наносит\s+на\s+(\d+)\s+повреждени\S*\s+больше/i,
    build: (m) => ({ op: 'bonusDamage', amount: Number(m[1]) }),
  },
  // «замешайте N случайных карт из своих потерь в колоду»
  {
    re: /замешайте\s+(\d+)\s+(?:\S+\s+)?карт\S*\s+из\s+(?:сво\S+|ваших)\s+потерь\s+в\s+колоду/i,
    build: (m) => ({ op: 'recoverFromCasualties', amount: Number(m[1]) }),
  },
  // «нанесите N повреждений выбранному штабу, технике или взводу»
  {
    re: /нанесите\s+(\d+)\s+повреждени\S*\s+выбранн\S*/i,
    build: (m) => ({ op: 'damage', target: 'chosen', amount: Number(m[1]) }),
  },
  // «верните выбранную технику в руку владельца»
  {
    re: /верните\s+выбранн\S*\s+техник\S*\s+в\s+руку/i,
    build: () => ({ op: 'bounce', target: 'chosenVehicle' }),
  },
  // «вся техника противника обнаружена» / «становятся обнаруженными»
  {
    re: /(?:вся\s+техника\s+противника\s+обнаружена|станов\S*\s+обнаруженн)/i,
    build: () => ({ op: 'spot', target: 'allEnemyVehicles' }),
  },
  // «игроки сбрасывают по N случайной карте из своей руки в потери»
  {
    re: /игроки\s+сбрасывают\s+по\s+(\d+)\s+случайн\S*\s+карт\S*\s+из\s+сво\S*\s+руки/i,
    build: (m) => ({ op: 'discardFromHand', target: 'both', amount: Number(m[1]) }),
  },
  // «противник сбрасывает N случайных карт из своей руки в потери»
  {
    re: /противник\s+сбрасывает\s+(\d+)\s+случайн\S*\s+карт\S*\s+из\s+своей\s+руки/i,
    build: (m) => ({ op: 'discardFromHand', target: 'enemy', amount: Number(m[1]) }),
  },
  // «получите N ресурсов»
  {
    re: /получи(?:те|т)\s+(\d+)\s+ресурс/i,
    build: (m) => ({ op: 'gainResources', amount: Number(m[1]) }),
  },
  // «переместите N случайных карт из своей колоды в потери»
  {
    re: /перемест\S*\s+(\d+)\s+случайн\S*\s+карт\S*\s+из\s+своей\s+колоды\s+в\s+потери/i,
    build: (m) => ({ op: 'mill', target: 'self', amount: Number(m[1]) }),
  },
  // «может атаковать ещё раз в этот ход» / «может атаковать дважды за ход»
  {
    re: /мо(?:жет|гут)\s+атаковать\s+(?:ещ[её]\s+раз|дважды)/i,
    build: () => ({ op: 'extraAttack', amount: 1 }),
  },
];

// Доля текста, которую обязаны покрыть сработавшие правила, чтобы считать разбор полным.
// Без этой проверки способность вроде «этот взвод уничтожается и штабу восстанавливается 6
// прочности. После этого возьмите карту» распознавалась только по «возьмите карту»
// и помечалась как полностью исполнимая, хотя движок потерял бы основной эффект.
const EFFECT_COVERAGE_THRESHOLD = 0.55;

function parseEffects(text) {
  const effects = [];
  let matchedChars = 0;

  for (const { re, build } of EFFECT_RULES) {
    const m = text.match(re);
    if (!m) continue;
    effects.push(build(m));
    matchedChars += m[0].length;
  }

  if (!effects.length) return [{ op: 'unparsed', text: text.trim() }];

  const meaningful = text.replace(/\s+/g, ' ').trim().length;
  if (meaningful > 0 && matchedChars / meaningful < EFFECT_COVERAGE_THRESHOLD) {
    effects.push({ op: 'unparsed', text: text.trim(), reason: 'разобрана только часть текста' });
  }
  return effects;
}

const DESCRIPTIVE = [
  /^это\s+базов\S*/i,                       // «Это базовый советский штаб»
  /^(т[яя]ж[её]лые|средние|л[её]гкие)\s+танки\s+/i, // пересказ общих правил класса
  /^пт-?\s?сау\s+/i,
  /^сау\s+/i,
  /^для\s+(розыгрыша|вывода)/i,
  /^этот\s+штаб\s+имеет/i,          // «Этот штаб имеет высокий прирост ресурсов…»
  /^защитные\s+взводы\s+принимают/i, // пересказ общего правила о защитных взводах
];

/** Строка описывает карту или пересказывает общие правила, а не задаёт способность. */
function isDescriptiveNote(body) {
  return DESCRIPTIVE.some((re) => re.test(body));
}

/**
 * Переводит одну строку способности в DSL.
 * coverage: 'full'    — движок исполнит полностью;
 *           'partial' — структура разобрана, но часть условий осталась текстом;
 *           'none'    — не разобрано, движок игнорирует.
 */
export function translateAbility(text, cardNation) {
  const { condition, body } = extractCondition(text, cardNation);
  if (!body) return { raw: text, condition, clauses: [], coverage: 'none' };

  // «Конвейер. Охранение.» — в одной строке перечислено несколько ключевых свойств.
  const parts = body.split(/\.\s+/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean);
  if (parts.length > 1) {
    const kws = parts.map((x) => KEYWORDS[x.toLowerCase()]).filter(Boolean);
    if (kws.length === parts.length) {
      return {
        raw: text,
        condition,
        clauses: kws.map((keyword) => ({ op: 'keyword', keyword })),
        coverage: 'full',
      };
    }
  }

  for (const { re, build } of RULES) {
    const m = body.match(re);
    if (!m) continue;
    const clauses = build(m);
    if (!clauses) continue;

    const hasUnparsed = JSON.stringify(clauses).includes('"unparsed"');
    const hasPartial = clauses.some((c) => c.partial) || JSON.stringify(clauses).includes('"partial":true');
    return {
      raw: text,
      condition,
      clauses,
      coverage: hasUnparsed ? 'partial' : hasPartial ? 'partial' : 'full',
    };
  }

  // Ключевое свойство может стоять внутри более длинной фразы.
  const kw = body.match(/\b(арьергард|арьегард|блиц|конвейер|маскировка|охранение|прикрытие|подкрепления)\b/i);
  if (kw && body.length < 40) {
    return {
      raw: text,
      condition,
      clauses: [{ op: 'keyword', keyword: KEYWORDS[kw[1].toLowerCase()] }],
      coverage: 'full',
    };
  }

  // Часть строк на вики — не способность, а пояснение к карте или пересказ общих
  // правил класса. Их не нужно исполнять, но и в «неразобранные» записывать нечестно.
  if (isDescriptiveNote(body)) {
    return { raw: text, condition, clauses: [{ op: 'note', text: body }], coverage: 'note' };
  }

  // Приказы и часть взводов записаны как голый эффект без триггера:
  // «Возьмите карту.», «Нанесите 3 повреждения штабу противника».
  // Такой текст исполняется в момент розыгрыша карты.
  const effects = parseEffects(body);
  const unparsedCount = effects.filter((e) => e.op === 'unparsed').length;
  if (unparsedCount === 0) {
    return { raw: text, condition, clauses: [{ op: 'onPlay', effects }], coverage: 'full' };
  }
  if (effects.length > unparsedCount) {
    return { raw: text, condition, clauses: [{ op: 'onPlay', effects }], coverage: 'partial' };
  }

  return { raw: text, condition, clauses: [{ op: 'unparsed', text: body }], coverage: 'none' };
}
