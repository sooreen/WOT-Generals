// Вычисление действующих характеристик карты.
//
// Часть свойств карты работает только под штабом определённой нации или типа
// («+3 к прочности» у Т-28 действует лишь на советских штабах). Поэтому статы
// нельзя брать из базы напрямую — их нужно считать относительно конкретного штаба.

import type { Ability, AbilityCondition, CardDef, HQType, Keyword, Nation } from '@wotg/shared';
import type { GameData } from '@wotg/shared';

export interface HqContext {
  nation: Nation;
  hqType: HQType;
  tier: number;
}

/** Работает ли зависимое свойство под данным штабом. */
export function conditionHolds(condition: AbilityCondition | null, hq: HqContext): boolean {
  if (!condition) return true;
  if (condition.hqNation && condition.hqNation !== hq.nation) return false;
  if (condition.hqType && condition.hqType !== hq.hqType) return false;
  return true;
}

export interface EffectiveStats {
  cost: number;
  attack: number;
  hp: number;
  income: number;
  support: number;
  keywords: Keyword[];
}

/**
 * Считает характеристики карты под конкретным штабом:
 * применяет активные модификаторы statBonus и собирает действующие ключевые свойства.
 */
export function effectiveStats(
  data: GameData,
  card: CardDef,
  hq: HqContext,
): EffectiveStats {
  const stats: EffectiveStats = {
    cost: card.cost ?? 0,
    attack: card.attack ?? 0,
    hp: card.hp ?? 0,
    income: card.income ?? 0,
    // Для взвода «поддержка» — это его атака: на неё усиливается штаб
    // или столько урона взвод поглощает.
    support: card.kind === 'platoon' ? (card.attack ?? 0) : 0,
    keywords: [],
  };

  const abilities: Ability[] = data.abilities[card.name] ?? [];
  for (const ability of abilities) {
    if (!conditionHolds(ability.condition, hq)) continue;

    for (const clause of ability.clauses) {
      if (clause.op === 'keyword') {
        const kw = clause.keyword as Keyword;
        if (!stats.keywords.includes(kw)) stats.keywords.push(kw);
        continue;
      }
      if (clause.op !== 'statBonus') continue;
      // Модификаторы с масштабом («за каждую САУ») зависят от позиции на поле,
      // здесь их не применяем — они помечены partial и учитываются отдельно.
      if (clause.per) continue;

      const amount = Number(clause.amount ?? 0);
      switch (clause.stat) {
        case 'hp':
          stats.hp += amount;
          break;
        case 'attack':
          stats.attack += amount;
          if (card.kind === 'platoon') stats.support += amount;
          break;
        case 'income':
          stats.income += amount;
          break;
        case 'cost':
          stats.cost = Math.max(0, stats.cost + amount);
          break;
        case 'support':
          stats.support += amount;
          break;
        default:
          break;
      }
    }
  }

  return stats;
}

/** Сколько копий карты допустимо в колоде: обычно 3, с «Конвейером» — уровень штаба + 3. */
export function maxCopies(card: CardDef, hqTier: number): number {
  return card.conveyor ? hqTier + 3 : 3;
}
