// Проверка полного цикла боя на реальных данных: раздача, ресурсы, ход, победа.

import { describe, expect, it } from 'vitest';
import { DECK_SIZE, HAND_LIMIT, STARTING_HAND } from '@wotg/shared';
import { buildDeckForHQ, validateDeck } from '../src/decks.js';
import { createGame, makeResolver, reduce, totalIncome, getLegalActions } from '../src/game.js';
import { data } from './helpers.js';

const HQS = data.cards.filter((c) => c.kind === 'hq');

function twoDecks() {
  const ussr = HQS.find((c) => c.nation === 'ussr' && c.hqType === 'training');
  const german = HQS.find((c) => c.nation === 'germany' && c.hqType === 'training');
  if (!ussr || !german) throw new Error('в базе нет учебных штабов обеих наций');
  return [buildDeckForHQ(data, ussr.name), buildDeckForHQ(data, german.name)] as const;
}

describe('состав колоды', () => {
  it('автосборка даёт ровно 40 карт и проходит проверку', () => {
    const [deck] = twoDecks();
    expect(deck.cards).toHaveLength(DECK_SIZE);
    const check = validateDeck(data, deck);
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
  });

  it('больше трёх копий обычной карты — ошибка', () => {
    const [deck] = twoDecks();
    const name = deck.cards[0] as string;
    const broken = { hq: deck.hq, cards: [name, name, name, name, ...deck.cards.slice(4)] };
    const check = validateDeck(data, broken);
    expect(check.valid).toBe(false);
    expect(check.errors.join(' ')).toContain(name);
  });

  it('балансный вес колоды считается по уровням карт', () => {
    const [deck] = twoDecks();
    expect(validateDeck(data, deck).balanceWeight).toBeGreaterThan(0);
  });
});

describe('начало боя', () => {
  it('оба игрока получают стартовую руку из 6 карт', () => {
    const [a, b] = twoDecks();
    const state = createGame(data, [a, b], 7);
    expect(state.players[0].hand).toHaveLength(STARTING_HAND);
    expect(state.players[1].hand).toHaveLength(STARTING_HAND);
  });

  it('ходящий первым в первом раунде не получает дополнительную карту', () => {
    const [a, b] = twoDecks();
    const state = createGame(data, [a, b], 7);
    // Рука ровно стартовая: добор в первый ход первого игрока не производится.
    expect(state.players[state.current].hand).toHaveLength(STARTING_HAND);
  });

  it('бой воспроизводится по seed', () => {
    const [a, b] = twoDecks();
    const first = createGame(data, [a, b], 1234);
    const second = createGame(data, [a, b], 1234);
    expect(second.players[0].hand).toEqual(first.players[0].hand);
    expect(second.current).toBe(first.current);
  });

  it('разные seed дают разные раздачи', () => {
    const [a, b] = twoDecks();
    const first = createGame(data, [a, b], 1);
    const second = createGame(data, [a, b], 999);
    expect(second.players[0].hand).not.toEqual(first.players[0].hand);
  });
});

describe('ход', () => {
  it('ресурсы в начале хода равны приросту и не накапливаются', () => {
    const [a, b] = twoDecks();
    let state = createGame(data, [a, b], 5);
    const income = totalIncome(state, state.current);
    expect(state.players[state.current].resources).toBe(income);

    // Завершаем два хода и убеждаемся, что запас установлен заново, а не сложен.
    state = reduce(state, { type: 'endTurn' }, data);
    state = reduce(state, { type: 'endTurn' }, data);
    expect(state.players[state.current].resources).toBe(totalIncome(state, state.current));
  });

  it('в конце хода рука урезается до лимита', () => {
    const [a, b] = twoDecks();
    let state = createGame(data, [a, b], 3);
    const me = state.current;
    state.players[me].hand = [...state.players[me].hand, ...state.players[me].deck.slice(0, 4)];
    expect(state.players[me].hand.length).toBeGreaterThan(HAND_LIMIT);

    state = reduce(state, { type: 'endTurn' }, data);
    expect(state.players[me].hand.length).toBeLessThanOrEqual(HAND_LIMIT);
  });

  it('ход переходит к сопернику', () => {
    const [a, b] = twoDecks();
    const state = createGame(data, [a, b], 11);
    const before = state.current;
    const after = reduce(state, { type: 'endTurn' }, data);
    expect(after.current).not.toBe(before);
  });

  it('список легальных ходов не пуст и всегда содержит завершение хода', () => {
    const [a, b] = twoDecks();
    const state = createGame(data, [a, b], 21);
    const actions = getLegalActions(state, makeResolver(data));
    expect(actions.length).toBeGreaterThan(1);
    expect(actions.some((x) => x.type === 'endTurn')).toBe(true);
  });

  it('вывод техники возможен только на плацдарм', () => {
    const [a, b] = twoDecks();
    const state = createGame(data, [a, b], 33);
    const deploys = getLegalActions(state, makeResolver(data)).filter((x) => x.type === 'deploy');
    const zone = new Set(['1,0', '1,1', '2,1', '0,3', '1,3', '1,4']);
    for (const d of deploys) {
      if (d.type !== 'deploy') continue;
      expect(zone.has(`${d.pos.row},${d.pos.col}`)).toBe(true);
    }
  });
});

describe('завершение боя', () => {
  it('бой заканчивается при обнулении прочности штаба', () => {
    const [a, b] = twoDecks();
    let state = createGame(data, [a, b], 8);
    const enemy = state.current === 0 ? 1 : 0;
    state.players[enemy].hq.hp = 0;

    state = reduce(state, { type: 'endTurn' }, data);
    expect(state.winner).not.toBeNull();
    expect(state.endReason).toBe('Штаб уничтожен');
  });
});
