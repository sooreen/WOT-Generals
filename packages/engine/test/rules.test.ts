// Проверка правил перемещения, обнаружения и геометрии поля.
// Каждый тест ссылается на формулировку из документации.

import { describe, expect, it } from 'vitest';
import { BOARD_COLS, BOARD_ROWS } from '@wotg/shared';
import { bridgehead, HQ_POSITIONS, neighbours } from '../src/state.js';
import { isSpotted, legalSteps, movementAllowance } from '../src/rules.js';
import { makeTestState, makeTestUnit } from './helpers.js';

describe('геометрия поля', () => {
  it('поле состоит из 15 клеток (3×5)', () => {
    expect(BOARD_ROWS * BOARD_COLS).toBe(15);
  });

  it('плацдарм — ровно 3 клетки вокруг своего штаба', () => {
    // «Розыгрыш техники можно производить только на 3 клетки вокруг своего штаба».
    expect(bridgehead(0)).toHaveLength(3);
    expect(bridgehead(1)).toHaveLength(3);
  });

  it('штабы стоят в противоположных углах', () => {
    expect(HQ_POSITIONS[0]).toEqual({ row: BOARD_ROWS - 1, col: 0 });
    expect(HQ_POSITIONS[1]).toEqual({ row: 0, col: BOARD_COLS - 1 });
  });

  it('соседство считается по всем восьми направлениям', () => {
    expect(neighbours({ row: 1, col: 2 })).toHaveLength(8);
  });
});

describe('перемещение по классам техники', () => {
  it('лёгкий танк проходит 2 клетки за ход', () => {
    const unit = makeTestUnit({ owner: 0, pos: { row: 1, col: 2 }, vehicleClass: 'light' });
    expect(movementAllowance(unit)).toBe(2);
  });

  it('средний, тяжёлый, ПТ-САУ и САУ проходят 1 клетку', () => {
    for (const cls of ['medium', 'heavy', 'td', 'spg'] as const) {
      const unit = makeTestUnit({ owner: 0, pos: { row: 1, col: 2 }, vehicleClass: cls });
      expect(movementAllowance(unit)).toBe(1);
    }
  });

  it('средний танк ходит по диагонали, тяжёлый — нет', () => {
    const state = makeTestState();
    const medium = makeTestUnit({ owner: 0, pos: { row: 1, col: 2 }, vehicleClass: 'medium' });
    const heavy = makeTestUnit({ owner: 0, pos: { row: 1, col: 2 }, vehicleClass: 'heavy' });
    medium.movesLeft = 1;
    heavy.movesLeft = 1;

    state.units = [medium];
    const mediumSteps = legalSteps(state, medium);
    expect(mediumSteps.some((p) => p.row !== 1 && p.col !== 2)).toBe(true);

    state.units = [heavy];
    const heavySteps = legalSteps(state, heavy);
    expect(heavySteps.every((p) => p.row === 1 || p.col === 2)).toBe(true);
  });

  it('техника не может встать на занятую клетку', () => {
    const state = makeTestState();
    const mover = makeTestUnit({ owner: 0, pos: { row: 1, col: 2 } });
    const blocker = makeTestUnit({ owner: 1, pos: { row: 1, col: 3 } });
    mover.movesLeft = 1;
    state.units = [mover, blocker];

    const steps = legalSteps(state, mover);
    expect(steps.some((p) => p.row === 1 && p.col === 3)).toBe(false);
  });

  it('выведенная в этот ход техника не ходит, кроме лёгких танков', () => {
    const heavy = makeTestUnit({ owner: 0, pos: { row: 2, col: 1 }, vehicleClass: 'heavy' });
    const light = makeTestUnit({ owner: 0, pos: { row: 2, col: 1 }, vehicleClass: 'light' });
    heavy.deployedThisTurn = true;
    light.deployedThisTurn = true;

    expect(movementAllowance(heavy)).toBe(0);
    expect(movementAllowance(light)).toBe(1);
  });
});

describe('обнаружение', () => {
  it('техника обнаружена, если рядом стоит чужая техника', () => {
    const state = makeTestState();
    const mine = makeTestUnit({ owner: 0, pos: { row: 1, col: 1 } });
    const theirs = makeTestUnit({ owner: 1, pos: { row: 1, col: 2 } });
    state.units = [mine, theirs];

    expect(isSpotted(state, theirs, 0)).toBe(true);
  });

  it('техника вдали от чужих карт не обнаружена', () => {
    const state = makeTestState();
    const mine = makeTestUnit({ owner: 0, pos: { row: 2, col: 1 } });
    const theirs = makeTestUnit({ owner: 1, pos: { row: 0, col: 3 } });
    state.units = [mine, theirs];

    expect(isSpotted(state, theirs, 0)).toBe(false);
  });

  it('штаб обнаруживает технику вплотную к себе', () => {
    const state = makeTestState();
    // (1,1) — клетка, соседняя со штабом игрока 0 в углу (2,0).
    const theirs = makeTestUnit({ owner: 1, pos: { row: 1, col: 1 } });
    state.units = [theirs];

    expect(isSpotted(state, theirs, 0)).toBe(true);
  });
});
