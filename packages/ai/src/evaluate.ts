// Оценочная функция позиции.
//
// Возвращает число с точки зрения игрока `me`: чем больше, тем лучше.
// Веса подобраны под темп игры: главное — прочность штабов, затем размен
// техникой, затем контроль поля и ресурсы.

import type { GameState, PlayerId } from '@wotg/engine';
import { HQ_POSITIONS, neighbours, opponentOf, samePos } from '@wotg/engine';

export interface EvalWeights {
  ownHqHp: number;
  enemyHqHp: number;
  unitHp: number;
  unitAttack: number;
  squadSupport: number;
  handSize: number;
  resources: number;
  pressure: number;   // своя техника рядом с вражеским штабом
  exposure: number;   // чужая техника рядом со своим штабом
  win: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  ownHqHp: 4,
  enemyHqHp: -5,   // урон по штабу противника ценнее сохранения своего: игра на добивание
  unitHp: 1,
  unitAttack: 1.5,
  squadSupport: 1.2,
  handSize: 0.4,
  resources: 0.2,
  pressure: 2.5,
  exposure: -2.5,
  win: 10_000,
};

export function evaluate(
  state: GameState,
  me: PlayerId,
  weights: EvalWeights = DEFAULT_WEIGHTS,
): number {
  if (state.winner !== null) {
    return state.winner === me ? weights.win : -weights.win;
  }

  const foe = opponentOf(me);
  const mine = state.players[me];
  const theirs = state.players[foe];

  let score = 0;
  score += mine.hq.hp * weights.ownHqHp;
  score += theirs.hq.hp * weights.enemyHqHp;

  for (const unit of state.units) {
    const sign = unit.owner === me ? 1 : -1;
    score += sign * (unit.hp * weights.unitHp + unit.attack * weights.unitAttack);
  }

  for (const squad of mine.squads) score += squad.support * weights.squadSupport;
  for (const squad of theirs.squads) score -= squad.support * weights.squadSupport;

  score += (mine.hand.length - theirs.hand.length) * weights.handSize;
  score += (mine.resources - theirs.resources) * weights.resources;

  // Давление на штаб: техника вплотную к чужому штабу бьёт по нему следующим ходом.
  const enemyHq = HQ_POSITIONS[foe];
  const ownHq = HQ_POSITIONS[me];
  for (const unit of state.units) {
    const nearEnemyHq = neighbours(enemyHq).some((p) => samePos(p, unit.pos));
    const nearOwnHq = neighbours(ownHq).some((p) => samePos(p, unit.pos));
    if (unit.owner === me && nearEnemyHq) score += weights.pressure;
    if (unit.owner !== me && nearOwnHq) score += weights.exposure;
  }

  return score;
}
