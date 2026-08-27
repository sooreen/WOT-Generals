// Правила перемещения и обнаружения.
//
// Источник — страница «Техника» вики Wargaming и раздел Battle Rules
// официального руководства. Формулировки приведены в docs/04-классы-техники.md.

import type { Keyword, Position, VehicleClass } from '@wotg/shared';
import type { GameState, PlayerId, UnitState } from './state.js';
import { HQ_POSITIONS, isOccupied, neighbours, samePos, unitAt } from './state.js';

/** Сколько клеток класс проходит за ход и разрешена ли диагональ. */
export const MOVEMENT: Record<VehicleClass, { steps: number; diagonal: boolean }> = {
  // «Легкие танки могут за ход переместиться на 2 клетки по вертикали и/или
  //  горизонтали, или на 1 клетку по диагонали».
  light: { steps: 2, diagonal: true },
  // «Средние танки могут перемещаться на 1 клетку по горизонтали, вертикали или диагонали».
  medium: { steps: 1, diagonal: true },
  // Тяжёлые, ПТ-САУ и САУ — «на 1 клетку по вертикали или горизонтали».
  heavy: { steps: 1, diagonal: false },
  td: { steps: 1, diagonal: false },
  spg: { steps: 1, diagonal: false },
};

export function isOrthogonal(from: Position, to: Position): boolean {
  const dr = Math.abs(from.row - to.row);
  const dc = Math.abs(from.col - to.col);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

export function isDiagonal(from: Position, to: Position): boolean {
  return Math.abs(from.row - to.row) === 1 && Math.abs(from.col - to.col) === 1;
}

export function hasKeyword(unit: { keywords: Keyword[] }, keyword: Keyword): boolean {
  return unit.keywords.includes(keyword);
}

/** Сколько шагов доступно технике в этот ход с учётом хода вывода. */
export function movementAllowance(unit: UnitState): number {
  if (hasKeyword(unit, 'immobile') || unit.moveBlocked) return 0;

  // «Техника, выведенная на плацдарм, на этом ходу не может перемещаться
  //  (исключением являются легкие танки)» — ЛТ получает ровно одну клетку.
  if (unit.deployedThisTurn) return unit.vehicleClass === 'light' ? 1 : 0;

  return MOVEMENT[unit.vehicleClass].steps;
}

/**
 * Клетки, куда техника может шагнуть прямо сейчас (один шаг).
 * Многошаговое перемещение лёгкого танка выполняется повторными шагами:
 * так естественно получается правило «подъехать, атаковать и отъехать»,
 * поскольку атака не расходует запас хода.
 */
export function legalSteps(state: GameState, unit: UnitState): Position[] {
  if (unit.movesLeft <= 0) return [];

  const rules = MOVEMENT[unit.vehicleClass];
  const out: Position[] = [];

  for (const p of neighbours(unit.pos)) {
    if (isOccupied(state, p)) continue;

    if (isOrthogonal(unit.pos, p)) {
      out.push(p);
      continue;
    }
    if (!rules.diagonal) continue;

    // Для лёгкого танка диагональ — альтернатива всему запасу хода, а не один шаг из двух:
    // «на 2 клетки по вертикали и/или горизонтали, ИЛИ на 1 клетку по диагонали».
    if (unit.vehicleClass === 'light' && unit.movesLeft < rules.steps) continue;
    out.push(p);
  }
  return out;
}

/** Стоимость шага в единицах запаса хода. Диагональ лёгкого танка съедает весь запас. */
export function stepCost(unit: UnitState, to: Position): number {
  if (unit.vehicleClass === 'light' && isDiagonal(unit.pos, to)) return unit.movesLeft;
  return 1;
}

/**
 * Обнаружена ли техника противника.
 * «Чтобы техника противника была обнаружена, необходимо, чтобы ваша техника
 *  находилась на соседней с ней клетке (на любой из 8 соседних)».
 * Штаб тоже обнаруживает технику вплотную к себе.
 */
export function isSpotted(state: GameState, target: UnitState, viewer: PlayerId): boolean {
  for (const p of neighbours(target.pos)) {
    const u = unitAt(state, p);
    if (u && u.owner === viewer) return true;
    if (samePos(p, HQ_POSITIONS[viewer])) return true;
  }
  return false;
}

/** Техника со свойством «Охранение» на своём плацдарме принимает удары по штабу. */
export function guardsFor(state: GameState, player: PlayerId): UnitState[] {
  const zone = neighbours(HQ_POSITIONS[player]);
  return state.units.filter(
    (u) => u.owner === player && hasKeyword(u, 'guard') && zone.some((p) => samePos(p, u.pos)),
  );
}
