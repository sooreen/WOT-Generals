// Модель состояния боя.
//
// Геометрия поля подтверждена тремя независимыми источниками (официальное
// руководство wotgenerals.com, страницы «Штаб» и «Техника» вики Wargaming):
//   • поле 3×5 = 15 клеток;
//   • штабы стоят в противоположных углах поля и занимают клетку;
//   • плацдарм — ровно 3 клетки, соседние со своим штабом;
//   • взводы стоят не на поле, а в отдельной зоне поддержки штаба (5 слотов
//     по числу специализаций).
// Проверка: угловая клетка поля 3×5 имеет ровно 3 соседа — это и есть плацдарм.

import type {
  HQType, Keyword, Nation, PlatoonBonus, PlatoonSpec, Position, VehicleClass,
} from '@wotg/shared';
import { BOARD_COLS, BOARD_ROWS } from '@wotg/shared';
import type { RngState } from './rng.js';

export type PlayerId = 0 | 1;

/** Экземпляр техники на поле. Отличается от определения карты изменяемым состоянием. */
export interface UnitState {
  uid: string;
  cardName: string;
  owner: PlayerId;
  pos: Position;
  hp: number;
  maxHp: number;
  attack: number;
  income: number;
  vehicleClass: VehicleClass;
  keywords: Keyword[];
  /** Сколько раз техника уже атаковала в текущий ход владельца. */
  attacksUsed: number;
  /** Контратака расходуется один раз за ход противника: отвечают только первому. */
  counterUsed: boolean;
  /** Клеток перемещения, оставшихся в этот ход. */
  movesLeft: number;
  /** Техника выведена в этот ход: перемещаться нельзя (исключение — лёгкие танки). */
  deployedThisTurn: boolean;
  /** Наложенный эффектом запрет на перемещение. */
  moveBlocked: boolean;
}

/** Взвод в зоне поддержки штаба. */
export interface SquadState {
  uid: string;
  cardName: string;
  owner: PlayerId;
  spec: PlatoonSpec;
  bonus: PlatoonBonus;
  hp: number;
  maxHp: number;
  /** «Поддержка» — величина, на которую взвод усиливает атаку или поглощает урон. */
  support: number;
  income: number;
  keywords: Keyword[];
}

export interface HQState {
  cardName: string;
  nation: Nation;
  hqType: HQType;
  tier: number;
  hp: number;
  maxHp: number;
  attack: number;
  income: number;
  pos: Position;
  attacksUsed: number;
  keywords: Keyword[];
}

export interface PlayerState {
  id: PlayerId;
  hq: HQState;
  hand: string[];
  deck: string[];
  casualties: string[];
  squads: SquadState[];
  resources: number;
}

export interface LogEntry {
  turn: number;
  player: PlayerId;
  text: string;
}

export interface GameState {
  players: [PlayerState, PlayerState];
  units: UnitState[];
  current: PlayerId;
  turn: number;
  rng: RngState;
  winner: PlayerId | null;
  /** Причина завершения боя — нужна интерфейсу и тестам. */
  endReason: string | null;
  log: LogEntry[];
  nextUid: number;
}

/** Штаб игрока 0 — в левом нижнем углу, игрока 1 — в противоположном. */
export const HQ_POSITIONS: Record<PlayerId, Position> = {
  0: { row: BOARD_ROWS - 1, col: 0 },
  1: { row: 0, col: BOARD_COLS - 1 },
};

export function inBounds(pos: Position): boolean {
  return pos.row >= 0 && pos.row < BOARD_ROWS && pos.col >= 0 && pos.col < BOARD_COLS;
}

export function samePos(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

/** Все восемь соседних клеток в пределах поля. Засвет работает именно по ним. */
export function neighbours(pos: Position): Position[] {
  const out: Position[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const p = { row: pos.row + dr, col: pos.col + dc };
      if (inBounds(p)) out.push(p);
    }
  }
  return out;
}

/** Плацдарм — клетки, соседние со своим штабом. Только туда выводится техника. */
export function bridgehead(player: PlayerId): Position[] {
  return neighbours(HQ_POSITIONS[player]);
}

export function unitAt(state: GameState, pos: Position): UnitState | undefined {
  return state.units.find((u) => samePos(u.pos, pos));
}

/** Клетка занята, если на ней стоит техника или штаб любого из игроков. */
export function isOccupied(state: GameState, pos: Position): boolean {
  if (unitAt(state, pos)) return true;
  return samePos(pos, HQ_POSITIONS[0]) || samePos(pos, HQ_POSITIONS[1]);
}

export function opponentOf(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

export function playerState(state: GameState, id: PlayerId): PlayerState {
  return state.players[id];
}
