// Проверка оппонентов: агенты обязаны выбирать только легальные ходы,
// а сила должна расти с уровнем сложности.

import { describe, expect, it } from 'vitest';
import { loadGameData } from '@wotg/shared/node';
import {
  buildDeckForHQ, createGame, getLegalActions, makeResolver, reduce, type GameState,
} from '@wotg/engine';
import { GeneralAgent, OfficerAgent, RecruitAgent, SergeantAgent } from '../src/agents.js';
import { evaluate } from '../src/evaluate.js';
import { describeAction, describeState } from '../src/describe.js';
import { createAgent } from '../src/factory.js';

const data = loadGameData();
const resolver = makeResolver(data);

const hqs = data.cards.filter((c) => c.kind === 'hq' && c.hqType === 'training');
const decks: [ReturnType<typeof buildDeckForHQ>, ReturnType<typeof buildDeckForHQ>] = [
  buildDeckForHQ(data, hqs.find((c) => c.nation === 'ussr')!.name),
  buildDeckForHQ(data, hqs.find((c) => c.nation === 'germany')!.name),
];

function sameAction(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Прогоняет партию до конца или до лимита ходов. */
async function playOut(a: ReturnType<typeof createAgent>, b: ReturnType<typeof createAgent>, seed: number) {
  let state: GameState = createGame(data, decks, seed);
  const agents = [a, b];
  for (let i = 0; i < 1500 && state.winner === null && state.turn < 90; i++) {
    const action = await agents[state.current]!.chooseAction(state, data);
    const before = state;
    state = reduce(state, action, data);
    if (state === before) state = reduce(state, { type: 'endTurn' }, data);
  }
  return state;
}

describe('корректность выбора хода', () => {
  const agents = [new RecruitAgent(), new SergeantAgent(), new OfficerAgent(2), new GeneralAgent(4, 6)];

  for (const agent of agents) {
    it(`«${agent.name}» выбирает только легальные ходы`, async () => {
      let state = createGame(data, decks, 101);
      for (let i = 0; i < 40 && state.winner === null; i++) {
        const legal = getLegalActions(state, resolver);
        if (!legal.length) break;
        const action = await agent.chooseAction(state, data);
        expect(legal.some((l) => sameAction(l, action))).toBe(true);
        state = reduce(state, action, data);
      }
    });
  }
});

describe('оценка позиции', () => {
  it('уничтоженный штаб противника оценивается как победа', () => {
    const state = createGame(data, decks, 5);
    state.winner = 0;
    expect(evaluate(state, 0)).toBeGreaterThan(1000);
    expect(evaluate(state, 1)).toBeLessThan(-1000);
  });

  it('урон по вражескому штабу улучшает оценку', () => {
    const base = createGame(data, decks, 5);
    const better = structuredClone(base);
    better.players[1].hq.hp -= 5;
    expect(evaluate(better, 0)).toBeGreaterThan(evaluate(base, 0));
  });
});

describe('описание позиции для нейросети', () => {
  it('в описании есть штабы, ресурсы и рука', () => {
    const state = createGame(data, decks, 9);
    const text = describeState(state, data);
    expect(text).toContain('Твой штаб');
    expect(text).toContain('Штаб противника');
    expect(text).toContain('Твоя рука');
  });

  it('каждый легальный ход описывается непустой строкой', () => {
    const state = createGame(data, decks, 9);
    for (const action of getLegalActions(state, resolver)) {
      expect(describeAction(state, action, data).length).toBeGreaterThan(3);
    }
  });
});

describe('сила уровней сложности', () => {
  // Партий немного, чтобы тест оставался быстрым; развёрнутый замер —
  // в tools/bench/selfplay.mts.
  it('Сержант обыгрывает Новобранца чаще, чем проигрывает', async () => {
    let sergeantWins = 0;
    let decided = 0;
    for (let i = 0; i < 6; i++) {
      const swap = i % 2 === 1;
      const state = await playOut(
        createAgent(swap ? 'recruit' : 'sergeant'),
        createAgent(swap ? 'sergeant' : 'recruit'),
        500 + i * 13,
      );
      if (state.winner === null) continue;
      decided++;
      const sergeantSide = swap ? 1 : 0;
      if (state.winner === sergeantSide) sergeantWins++;
    }
    expect(decided).toBeGreaterThan(0);
    expect(sergeantWins * 2).toBeGreaterThan(decided);
  }, 60_000);
});
