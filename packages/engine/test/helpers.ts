// Вспомогательные конструкторы для тестов: собирают минимальное состояние боя,
// в котором проверяется ровно одно правило.

import type { GameData } from '@wotg/shared';
import { loadGameData } from '@wotg/shared/node';
import type { GameState, PlayerId, UnitState } from '../src/state.js';
import { HQ_POSITIONS } from '../src/state.js';
import type { VehicleClass, Keyword } from '@wotg/shared';

export const data: GameData = loadGameData();

let uidCounter = 0;

export function makeTestUnit(partial: {
  owner: PlayerId;
  pos: { row: number; col: number };
  vehicleClass?: VehicleClass;
  hp?: number;
  attack?: number;
  keywords?: Keyword[];
  cardName?: string;
}): UnitState {
  const hp = partial.hp ?? 5;
  return {
    uid: `t${++uidCounter}`,
    cardName: partial.cardName ?? 'test-unit',
    owner: partial.owner,
    pos: partial.pos,
    hp,
    maxHp: hp,
    attack: partial.attack ?? 2,
    income: 0,
    vehicleClass: partial.vehicleClass ?? 'medium',
    keywords: partial.keywords ?? [],
    attacksUsed: 0,
    counterUsed: false,
    movesLeft: 1,
    deployedThisTurn: false,
    moveBlocked: false,
  };
}

/** Пустой бой без карт: техника расставляется тестом вручную. */
export function makeTestState(overrides: Partial<GameState> = {}): GameState {
  const mkPlayer = (id: PlayerId) => ({
    id,
    hq: {
      cardName: `hq${id}`,
      nation: 'ussr' as const,
      hqType: 'training' as const,
      tier: 1,
      hp: 20,
      maxHp: 20,
      attack: 1,
      income: 3,
      pos: HQ_POSITIONS[id],
      attacksUsed: 0,
      keywords: [] as Keyword[],
    },
    hand: [] as string[],
    deck: [] as string[],
    casualties: [] as string[],
    squads: [],
    resources: 10,
  });

  return {
    players: [mkPlayer(0), mkPlayer(1)],
    units: [],
    current: 0,
    turn: 1,
    rng: { seed: 42 },
    winner: null,
    endReason: null,
    log: [],
    nextUid: 1,
    ...overrides,
  } as GameState;
}
