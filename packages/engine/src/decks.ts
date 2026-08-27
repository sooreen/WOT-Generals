// Проверка колод и сборка готовых колод из базы карт.
//
// Правила состава подтверждены официальным руководством:
//   «Every deck contains 41 cards; no more, no less. Every deck has only one HQ.»
//   «В колоде не может быть больше 3х копий карты, кроме карт со способностью Конвейер».

import type { CardDef, GameData } from '@wotg/shared';
import { DECK_SIZE, MAX_COPIES } from '@wotg/shared';
import type { DeckSpec } from './game.js';
import { maxCopies } from './cards.js';

export interface DeckValidation {
  valid: boolean;
  errors: string[];
  balanceWeight: number;
}

/** Балансный вес карты по уровню — таблица со страницы «Штаб» вики Wargaming. */
const CARD_WEIGHT: Record<number, number> = {
  1: 1, 2: 3, 3: 7, 4: 15, 5: 31, 6: 63, 7: 127, 8: 255, 9: 511, 10: 1023,
};

/** Балансный вес штаба зависит от его уровня. */
const HQ_WEIGHT: Record<number, number> = { 1: 10, 4: 150, 8: 1500 };

export function deckBalanceWeight(data: GameData, deck: DeckSpec): number {
  const hq = data.byName.get(deck.hq);
  const hqWeight = HQ_WEIGHT[hq?.tier ?? 1] ?? 10;
  const cards = deck.cards.reduce((sum, name) => {
    const card = data.byName.get(name);
    return sum + (CARD_WEIGHT[card?.tier ?? 1] ?? 1);
  }, 0);
  return hqWeight + cards;
}

export function validateDeck(data: GameData, deck: DeckSpec): DeckValidation {
  const errors: string[] = [];

  const hq = data.byName.get(deck.hq);
  if (!hq) errors.push(`Штаб «${deck.hq}» не найден в базе`);
  else if (hq.kind !== 'hq') errors.push(`Карта «${deck.hq}» не является штабом`);

  if (deck.cards.length !== DECK_SIZE) {
    errors.push(`В колоде ${deck.cards.length} карт вместо ${DECK_SIZE}`);
  }

  const counts = new Map<string, number>();
  for (const name of deck.cards) {
    const card = data.byName.get(name);
    if (!card) {
      errors.push(`Карта «${name}» не найдена в базе`);
      continue;
    }
    if (card.kind === 'hq') errors.push(`Штаб «${name}» не может быть в основной части колоды`);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const hqTier = hq?.tier ?? 1;
  for (const [name, count] of counts) {
    const card = data.byName.get(name);
    if (!card) continue;
    const limit = maxCopies(card, hqTier);
    if (count > limit) {
      const why = card.conveyor ? `«Конвейер»: уровень штаба + 3 = ${limit}` : `лимит ${MAX_COPIES}`;
      errors.push(`«${name}»: ${count} копий, допустимо ${limit} (${why})`);
    }
  }

  return { valid: errors.length === 0, errors, balanceWeight: deckBalanceWeight(data, deck) };
}

/**
 * Собирает работоспособную колоду вокруг заданного штаба.
 * Используется для готовых колод и как запасной вариант, когда игрок не выбрал свою.
 * Берём карты нации штаба, отдавая предпочтение доступным по стоимости.
 */
export function buildDeckForHQ(data: GameData, hqName: string): DeckSpec {
  const hq = data.byName.get(hqName);
  if (!hq) throw new Error(`Штаб не найден: ${hqName}`);

  const pool = data.cards.filter(
    (c: CardDef) =>
      c.kind !== 'hq' &&
      c.nation === hq.nation &&
      c.rarity !== 'removed' &&
      (c.tier ?? 1) <= Math.max(4, (hq.tier ?? 1) + 1),
  );

  // Дешёвые карты идут первыми: колода, состоящая только из дорогих карт, неиграбельна.
  const sorted = [...pool].sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.name.localeCompare(b.name));

  const cards: string[] = [];
  const counts = new Map<string, number>();
  const hqTier = hq.tier ?? 1;

  while (cards.length < DECK_SIZE) {
    let added = false;
    for (const card of sorted) {
      if (cards.length >= DECK_SIZE) break;
      const used = counts.get(card.name) ?? 0;
      if (used >= Math.min(3, maxCopies(card, hqTier))) continue;
      cards.push(card.name);
      counts.set(card.name, used + 1);
      added = true;
    }
    if (!added) break; // пул исчерпан — вернём то, что удалось собрать
  }

  return { hq: hqName, cards };
}
