// Проверка разрешения боя: контратаки, приоритет ПТ-САУ, поглощение урона.
// Формулировки правил — в docs/02-бой.md.

import { describe, expect, it } from 'vitest';
import { applyDamageToHQ, canCounterattack, hqFirepower, resolveAttack } from '../src/combat.js';
import { canHqAttack, canUnitAttack } from '../src/actions.js';
import type { SquadState } from '../src/state.js';
import { makeTestState, makeTestUnit } from './helpers.js';

function squad(partial: Partial<SquadState> & Pick<SquadState, 'bonus'>): SquadState {
  return {
    uid: 's1',
    cardName: 'тестовый взвод',
    owner: 0,
    spec: 'recon',
    hp: 5,
    maxHp: 5,
    support: 2,
    income: 0,
    keywords: [],
    ...partial,
  } as SquadState;
}

describe('атака и контратака', () => {
  it('урон при атаке и контратаке наносится одновременно', () => {
    const state = makeTestState();
    const a = makeTestUnit({ owner: 0, pos: { row: 1, col: 1 }, attack: 2, hp: 5 });
    const b = makeTestUnit({ owner: 1, pos: { row: 1, col: 2 }, attack: 3, hp: 5 });
    state.units = [a, b];

    const res = resolveAttack(state, { kind: 'unit', uid: a.uid }, { kind: 'unit', uid: b.uid });

    expect(res.attackerDamage).toBe(2);
    expect(res.counterDamage).toBe(3);
    expect(state.units.find((u) => u.uid === a.uid)?.hp).toBe(2); // 5 − 3
    expect(state.units.find((u) => u.uid === b.uid)?.hp).toBe(3); // 5 − 2
  });

  it('ПТ-САУ бьёт первой: уничтоженная цель не контратакует', () => {
    const state = makeTestState();
    const td = makeTestUnit({ owner: 0, pos: { row: 1, col: 1 }, vehicleClass: 'td', attack: 5, hp: 4 });
    const victim = makeTestUnit({ owner: 1, pos: { row: 1, col: 2 }, attack: 3, hp: 4 });
    state.units = [td, victim];

    const res = resolveAttack(state, { kind: 'unit', uid: td.uid }, { kind: 'unit', uid: victim.uid });

    expect(res.counterDamage).toBe(0);
    expect(state.units.find((u) => u.uid === td.uid)?.hp).toBe(4); // урона не получила
    expect(state.units.find((u) => u.uid === victim.uid)).toBeUndefined();
  });

  it('две ПТ-САУ обмениваются уроном одновременно — даже уничтоженная отвечает', () => {
    const state = makeTestState();
    const a = makeTestUnit({ owner: 0, pos: { row: 1, col: 1 }, vehicleClass: 'td', attack: 5, hp: 4 });
    const b = makeTestUnit({ owner: 1, pos: { row: 1, col: 2 }, vehicleClass: 'td', attack: 3, hp: 4 });
    state.units = [a, b];

    const res = resolveAttack(state, { kind: 'unit', uid: a.uid }, { kind: 'unit', uid: b.uid });

    expect(res.counterDamage).toBe(3);
    expect(state.units.find((u) => u.uid === b.uid)).toBeUndefined();
    expect(state.units.find((u) => u.uid === a.uid)?.hp).toBe(1); // 4 − 3
  });

  it('тяжёлый танк, атаковавший в свой ход, не контратакует', () => {
    const state = makeTestState();
    const attacker = makeTestUnit({ owner: 0, pos: { row: 1, col: 1 }, attack: 2 });
    const heavy = makeTestUnit({ owner: 1, pos: { row: 1, col: 2 }, vehicleClass: 'heavy', attack: 4, hp: 9 });
    heavy.attacksUsed = 1;
    state.units = [attacker, heavy];

    expect(canCounterattack(state, { kind: 'unit', uid: attacker.uid }, heavy)).toBe(false);
  });

  it('тяжёлый танк, не атаковавший в свой ход, контратакует', () => {
    const state = makeTestState();
    const attacker = makeTestUnit({ owner: 0, pos: { row: 1, col: 1 }, attack: 2 });
    const heavy = makeTestUnit({ owner: 1, pos: { row: 1, col: 2 }, vehicleClass: 'heavy', attack: 4, hp: 9 });
    state.units = [attacker, heavy];

    expect(canCounterattack(state, { kind: 'unit', uid: attacker.uid }, heavy)).toBe(true);
  });

  it('САУ не контратакует и не получает контратак', () => {
    const state = makeTestState();
    const spg = makeTestUnit({ owner: 0, pos: { row: 2, col: 1 }, vehicleClass: 'spg', attack: 3, hp: 4 });
    const victim = makeTestUnit({ owner: 1, pos: { row: 0, col: 3 }, attack: 5, hp: 9 });
    state.units = [spg, victim];

    const res = resolveAttack(state, { kind: 'unit', uid: spg.uid }, { kind: 'unit', uid: victim.uid });
    expect(res.counterDamage).toBe(0);
    expect(state.units.find((u) => u.uid === spg.uid)?.hp).toBe(4);

    // И сама САУ в роли защитника не отвечает.
    const other = makeTestUnit({ owner: 1, pos: { row: 2, col: 2 }, attack: 2 });
    state.units.push(other);
    expect(canCounterattack(state, { kind: 'unit', uid: other.uid }, spg)).toBe(false);
  });

  it('атака штабом не получает ответного урона', () => {
    const state = makeTestState();
    const victim = makeTestUnit({ owner: 1, pos: { row: 1, col: 1 }, attack: 9, hp: 9 });
    state.units = [victim];

    const res = resolveAttack(state, { kind: 'hq', player: 0 }, { kind: 'unit', uid: victim.uid });
    expect(res.counterDamage).toBe(0);
    expect(state.players[0].hq.hp).toBe(20);
  });

  it('свойство «Прикрытие» отменяет контратаку', () => {
    const state = makeTestState();
    const attacker = makeTestUnit({ owner: 0, pos: { row: 1, col: 1 }, attack: 2, keywords: ['cover'] });
    const defender = makeTestUnit({ owner: 1, pos: { row: 1, col: 2 }, attack: 4, hp: 9 });
    state.units = [attacker, defender];

    const res = resolveAttack(state, { kind: 'unit', uid: attacker.uid }, { kind: 'unit', uid: defender.uid });
    expect(res.counterDamage).toBe(0);
  });

  it('контратака расходуется один раз за ход: отвечает только первому', () => {
    const state = makeTestState();
    const a1 = makeTestUnit({ owner: 0, pos: { row: 1, col: 1 }, attack: 1 });
    const a2 = makeTestUnit({ owner: 0, pos: { row: 0, col: 1 }, attack: 1 });
    const def = makeTestUnit({ owner: 1, pos: { row: 1, col: 2 }, attack: 3, hp: 20 });
    state.units = [a1, a2, def];

    const first = resolveAttack(state, { kind: 'unit', uid: a1.uid }, { kind: 'unit', uid: def.uid });
    expect(first.counterDamage).toBe(3);

    const second = resolveAttack(state, { kind: 'unit', uid: a2.uid }, { kind: 'unit', uid: def.uid });
    expect(second.counterDamage).toBe(0);
  });
});

describe('урон по штабу', () => {
  it('защитный взвод поглощает урон в пределах своей поддержки', () => {
    const state = makeTestState();
    state.players[0].squads = [squad({ bonus: 'defence', support: 2, hp: 5 })];
    const notes: string[] = [];

    // Атака на 3: взвод берёт 2, штаб получает 1.
    applyDamageToHQ(state, 0, 3, notes);

    expect(state.players[0].squads[0]?.hp).toBe(3);
    expect(state.players[0].hq.hp).toBe(19);
  });

  it('атакующий взвод усиливает штаб и получает урон, равный поддержке', () => {
    const state = makeTestState();
    state.players[0].squads = [squad({ bonus: 'attack', support: 2, hp: 5 })];
    const victim = makeTestUnit({ owner: 1, pos: { row: 1, col: 1 }, attack: 0, hp: 9 });
    state.units = [victim];

    expect(hqFirepower(state, 0)).toBe(3); // 1 у штаба + 2 поддержки

    resolveAttack(state, { kind: 'hq', player: 0 }, { kind: 'unit', uid: victim.uid });
    expect(state.units.find((u) => u.uid === victim.uid)?.hp).toBe(6); // 9 − 3
    expect(state.players[0].squads[0]?.hp).toBe(3); // 5 − 2
  });

  it('«Охранение» на плацдарме принимает весь удар по штабу', () => {
    const state = makeTestState();
    // (1,1) входит в плацдарм игрока 0 (штаб в углу (2,0)).
    const guard = makeTestUnit({ owner: 0, pos: { row: 1, col: 1 }, hp: 9, keywords: ['guard'] });
    state.units = [guard];
    const notes: string[] = [];

    applyDamageToHQ(state, 0, 4, notes);

    expect(state.units.find((u) => u.uid === guard.uid)?.hp).toBe(5);
    expect(state.players[0].hq.hp).toBe(20); // штаб не получил урона
  });
});

describe('дальность атаки штаба и САУ', () => {
  it('штаб бьёт вражеский штаб через всё поле', () => {
    // «Штаб может атаковать незамаскированный штаб противника» — соседство не требуется.
    // На этом построена известная тактика «АВШД» из глоссария игры.
    const state = makeTestState();
    expect(canHqAttack(state, 0, { kind: 'hq', player: 1 })).toBe(true);
  });

  it('«Маскировка» закрывает технику от штаба и от САУ', () => {
    const state = makeTestState();
    const hidden = makeTestUnit({ owner: 1, pos: { row: 1, col: 1 }, keywords: ['camouflage'] });
    state.units = [hidden];

    // Техника обнаружена (стоит вплотную к штабу), но замаскирована.
    expect(canHqAttack(state, 0, { kind: 'unit', uid: hidden.uid })).toBe(false);

    const spg = makeTestUnit({ owner: 0, pos: { row: 2, col: 1 }, vehicleClass: 'spg' });
    state.units.push(spg);
    expect(canUnitAttack(state, spg, { kind: 'unit', uid: hidden.uid })).toBe(false);
  });

  it('штаб не бьёт необнаруженную технику', () => {
    const state = makeTestState();
    const far = makeTestUnit({ owner: 1, pos: { row: 0, col: 2 } });
    state.units = [far];
    expect(canHqAttack(state, 0, { kind: 'unit', uid: far.uid })).toBe(false);
  });

  it('САУ бьёт любую обнаруженную цель на поле, обычный танк — только вплотную', () => {
    const state = makeTestState();
    const spotter = makeTestUnit({ owner: 0, pos: { row: 0, col: 1 } });
    const target = makeTestUnit({ owner: 1, pos: { row: 0, col: 2 } });
    const spg = makeTestUnit({ owner: 0, pos: { row: 2, col: 1 }, vehicleClass: 'spg' });
    const tank = makeTestUnit({ owner: 0, pos: { row: 2, col: 2 }, vehicleClass: 'medium' });
    state.units = [spotter, target, spg, tank];

    expect(canUnitAttack(state, spg, { kind: 'unit', uid: target.uid })).toBe(true);
    expect(canUnitAttack(state, tank, { kind: 'unit', uid: target.uid })).toBe(false);
  });

  it('техника атакует только один раз за ход', () => {
    const state = makeTestState();
    const attacker = makeTestUnit({ owner: 0, pos: { row: 1, col: 1 } });
    const victim = makeTestUnit({ owner: 1, pos: { row: 1, col: 2 }, hp: 20 });
    state.units = [attacker, victim];

    expect(canUnitAttack(state, attacker, { kind: 'unit', uid: victim.uid })).toBe(true);
    attacker.attacksUsed = 1;
    expect(canUnitAttack(state, attacker, { kind: 'unit', uid: victim.uid })).toBe(false);
  });
});
