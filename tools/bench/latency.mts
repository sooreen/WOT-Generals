// Замер времени принятия решения — от него зависит, комфортно ли играть против ИИ.
//
// Замеряем не любую позицию, а самую нагруженную из встреченных в партии:
// именно она определяет наихудшую задержку, которую почувствует игрок.

import { loadGameData } from '@wotg/shared/node';
import {
  buildDeckForHQ, createGame, getLegalActions, makeResolver, reduce, type GameState,
} from '@wotg/engine';
import { createAgent, type OpponentMode } from '@wotg/ai';

const data = loadGameData();
const resolver = makeResolver(data);
const hqs = data.cards.filter((c) => c.kind === 'hq' && c.hqType === 'training');
const decks: [ReturnType<typeof buildDeckForHQ>, ReturnType<typeof buildDeckForHQ>] = [
  buildDeckForHQ(data, hqs.find((c) => c.nation === 'ussr')!.name),
  buildDeckForHQ(data, hqs.find((c) => c.nation === 'germany')!.name),
];

let state: GameState = createGame(data, decks, 77);
const warm = createAgent('sergeant');

let hardest: GameState = state;
let hardestCount = getLegalActions(state, resolver).length;

for (let i = 0; i < 200 && state.winner === null; i++) {
  const count = getLegalActions(state, resolver).length;
  if (count > hardestCount) {
    hardestCount = count;
    hardest = state;
  }
  state = reduce(state, await warm.chooseAction(state, data), data);
}

console.log(
  `Самая нагруженная позиция: ход ${hardest.turn}, техники ${hardest.units.length}, ` +
    `легальных ходов ${hardestCount}, ресурсов ${hardest.players[hardest.current].resources}\n`,
);

for (const mode of ['recruit', 'sergeant', 'officer', 'general'] as OpponentMode[]) {
  const agent = createAgent(mode);
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await agent.chooseAction(hardest, data);
    times.push(performance.now() - t0);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`${mode.padEnd(9)} среднее ${avg.toFixed(0)} мс, максимум ${Math.max(...times).toFixed(0)} мс`);
}
