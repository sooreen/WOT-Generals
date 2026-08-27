// Самоигра: проверяем, что уровни сложности действительно различаются по силе.
// Запуск: npx tsx tools/bench/selfplay.mts [партий]

import { loadGameData } from '@wotg/shared/node';
import { buildDeckForHQ, createGame, reduce, type GameState } from '@wotg/engine';
import { createAgent, type OpponentMode } from '@wotg/ai';

const data = loadGameData();
const GAMES = Number(process.argv[2] ?? 20);
const MAX_TURNS = 120;

const hqs = data.cards.filter((c) => c.kind === 'hq' && c.hqType === 'training');
const ussr = hqs.find((c) => c.nation === 'ussr')!;
const germany = hqs.find((c) => c.nation === 'germany')!;
const decks: [ReturnType<typeof buildDeckForHQ>, ReturnType<typeof buildDeckForHQ>] = [
  buildDeckForHQ(data, ussr.name),
  buildDeckForHQ(data, germany.name),
];

async function playGame(a: OpponentMode, b: OpponentMode, seed: number) {
  const agents = [createAgent(a), createAgent(b)];
  let state: GameState = createGame(data, decks, seed);
  let steps = 0;

  while (state.winner === null && state.turn < MAX_TURNS && steps < 4000) {
    const agent = agents[state.current]!;
    const action = await agent.chooseAction(state, data);
    const before = state;
    state = reduce(state, action, data);
    steps++;
    // Защита от зацикливания: если ход ничего не изменил, принудительно завершаем ход.
    if (state === before) state = reduce(state, { type: 'endTurn' }, data);
  }
  return state;
}

async function match(a: OpponentMode, b: OpponentMode, games: number) {
  let winsA = 0, winsB = 0, draws = 0;
  for (let i = 0; i < games; i++) {
    // Стороны чередуются, чтобы преимущество первого хода не искажало результат.
    const swap = i % 2 === 1;
    const state = await playGame(swap ? b : a, swap ? a : b, 1000 + i * 7);
    if (state.winner === null) draws++;
    else {
      const winnerIsA = swap ? state.winner === 1 : state.winner === 0;
      if (winnerIsA) winsA++; else winsB++;
    }
  }
  return { winsA, winsB, draws };
}

const pairs: Array<[OpponentMode, OpponentMode]> = [
  ['sergeant', 'recruit'],
  ['officer', 'sergeant'],
  ['general', 'officer'],
  ['general', 'recruit'],
];

console.log(`Самоигра: по ${GAMES} партий на пару, лимит ${MAX_TURNS} ходов\n`);
for (const [a, b] of pairs) {
  const t0 = Date.now();
  const r = await match(a, b, GAMES);
  const decided = r.winsA + r.winsB;
  const rate = decided ? ((r.winsA / decided) * 100).toFixed(0) : '—';
  console.log(
    `${a.padEnd(9)} против ${b.padEnd(9)}  ${r.winsA}:${r.winsB}` +
      `  ничьих ${r.draws}  доля побед ${rate}%  (${((Date.now() - t0) / 1000).toFixed(1)} с)`,
  );
}
