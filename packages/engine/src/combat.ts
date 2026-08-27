// Разрешение атаки и контратаки.
//
// Правила (страница «Техника» вики Wargaming, раздел Battle Rules руководства):
//   • урон равен огневой мощи; при атаке и контратаке урон наносится одновременно;
//   • контратака расходуется один раз за ход и достаётся только первому атакующему;
//   • ПТ-САУ бьёт первой: если цель уничтожена, она не отвечает;
//   • две ПТ-САУ обмениваются уроном одновременно — даже уничтоженная контратакует;
//   • не контратакуют: при ударе штаба или САУ, при свойстве «Прикрытие» у атакующего,
//     тяжёлый танк, уже атаковавший в свой ход, а также сами САУ и штабы.

import type { GameState, PlayerId, SquadState, UnitState } from './state.js';
import { HQ_POSITIONS, opponentOf, playerState, samePos } from './state.js';
import { guardsFor, hasKeyword } from './rules.js';

export type AttackerRef = { kind: 'unit'; uid: string } | { kind: 'hq'; player: PlayerId };
export type TargetRef = { kind: 'unit'; uid: string } | { kind: 'hq'; player: PlayerId };

export interface CombatResult {
  attackerDamage: number;  // урон, нанесённый атакующим
  counterDamage: number;   // урон, полученный атакующим в ответ
  destroyed: string[];     // uid уничтоженной техники
  notes: string[];
}

function findUnit(state: GameState, uid: string): UnitState | undefined {
  return state.units.find((u) => u.uid === uid);
}

/** Огневая мощь штаба с учётом атакующих взводов в зоне поддержки. */
export function hqFirepower(state: GameState, player: PlayerId): number {
  const p = playerState(state, player);
  const squadBonus = p.squads
    .filter((s) => s.bonus === 'attack')
    .reduce((sum, s) => sum + s.support, 0);
  return p.hq.attack + squadBonus;
}

/**
 * Может ли цель контратаковать в ответ на эту атаку.
 * Собрано в одном месте, потому что исключений много и они взаимодействуют.
 */
export function canCounterattack(
  state: GameState,
  attacker: AttackerRef,
  defender: UnitState,
): boolean {
  // Штаб и САУ бьют дистанционно — ответа не получают.
  if (attacker.kind === 'hq') return false;
  const atkUnit = findUnit(state, attacker.uid);
  if (!atkUnit) return false;
  if (atkUnit.vehicleClass === 'spg') return false;

  // «Прикрытие»: карту нельзя контратаковать.
  if (hasKeyword(atkUnit, 'cover')) return false;

  // САУ никогда не контратакует.
  if (defender.vehicleClass === 'spg') return false;

  // Контратака — один раз за ход противника, отвечает только первому атакующему.
  if (defender.counterUsed) return false;

  // Тяжёлый танк контратакует, только если сам не атаковал в свой ход.
  if (defender.vehicleClass === 'heavy' && defender.attacksUsed > 0) return false;

  return true;
}

/** Урон по штабу: сначала «Охранение», затем защитные взводы, остаток — по штабу. */
export function applyDamageToHQ(
  state: GameState,
  player: PlayerId,
  amount: number,
  notes: string[],
): { destroyed: string[] } {
  const destroyed: string[] = [];
  let remaining = amount;

  // «Охранение»: техника на плацдарме принимает на себя весь удар по штабу.
  const guards = guardsFor(state, player);
  const guard = guards[0];
  if (guard && remaining > 0) {
    guard.hp -= remaining;
    notes.push(`«Охранение»: ${guard.cardName} принимает ${remaining} урона вместо штаба`);
    remaining = 0;
    if (guard.hp <= 0) destroyed.push(guard.uid);
    return { destroyed };
  }

  // Защитные взводы поглощают урон в пределах своей поддержки.
  const p = playerState(state, player);
  for (const squad of p.squads.filter((s) => s.bonus === 'defence')) {
    if (remaining <= 0) break;
    const absorbed = Math.min(remaining, squad.support);
    squad.hp -= absorbed;
    remaining -= absorbed;
    notes.push(`Взвод ${squad.cardName} поглощает ${absorbed} урона`);
  }
  p.squads = p.squads.filter((s) => s.hp > 0);

  if (remaining > 0) {
    p.hq.hp -= remaining;
    notes.push(`Штаб получает ${remaining} урона (осталось ${Math.max(0, p.hq.hp)})`);
  }
  return { destroyed };
}

/**
 * Проводит атаку и возвращает её результат.
 * Состояние изменяется на месте: reducer работает с уже склонированным состоянием.
 */
export function resolveAttack(
  state: GameState,
  attacker: AttackerRef,
  target: TargetRef,
): CombatResult {
  const notes: string[] = [];
  const destroyed: string[] = [];

  const attackerPower =
    attacker.kind === 'hq'
      ? hqFirepower(state, attacker.player)
      : (findUnit(state, attacker.uid)?.attack ?? 0);

  // Атакующие взводы получают урон, равный своей поддержке, когда штаб атакует.
  if (attacker.kind === 'hq') {
    const p = playerState(state, attacker.player);
    for (const squad of p.squads.filter((s) => s.bonus === 'attack')) {
      squad.hp -= squad.support;
      notes.push(`Атакующий взвод ${squad.cardName} получает ${squad.support} урона`);
    }
    p.squads = p.squads.filter((s) => s.hp > 0);
    p.hq.attacksUsed++;
  } else {
    const u = findUnit(state, attacker.uid);
    if (u) u.attacksUsed++;
  }

  // Удар по штабу.
  if (target.kind === 'hq') {
    const res = applyDamageToHQ(state, target.player, attackerPower, notes);
    destroyed.push(...res.destroyed);
    state.units = state.units.filter((u) => !destroyed.includes(u.uid));
    return { attackerDamage: attackerPower, counterDamage: 0, destroyed, notes };
  }

  const defender = findUnit(state, target.uid);
  if (!defender) return { attackerDamage: 0, counterDamage: 0, destroyed: [], notes };

  const atkUnit = attacker.kind === 'unit' ? findUnit(state, attacker.uid) : undefined;
  const attackerIsTd = atkUnit?.vehicleClass === 'td';
  const defenderIsTd = defender.vehicleClass === 'td';

  const counterAllowed = canCounterattack(state, attacker, defender);
  let counterDamage = 0;

  // ПТ-САУ наносит урон первой. Если цель погибла — ответа нет.
  // Исключение: две ПТ-САУ бьют одновременно, и погибшая всё равно отвечает.
  const tdStrikesFirst = attackerIsTd && !defenderIsTd;

  defender.hp -= attackerPower;
  const defenderDies = defender.hp <= 0;

  if (counterAllowed && !(tdStrikesFirst && defenderDies)) {
    counterDamage = defender.attack;
    defender.counterUsed = true;
    if (attacker.kind === 'unit' && atkUnit) {
      atkUnit.hp -= counterDamage;
      notes.push(`${defender.cardName} контратакует на ${counterDamage}`);
      if (atkUnit.hp <= 0) destroyed.push(atkUnit.uid);
    }
  } else if (tdStrikesFirst && defenderDies) {
    notes.push(`ПТ-САУ бьёт первой: ${defender.cardName} уничтожен и не контратакует`);
  }

  if (defenderDies) destroyed.push(defender.uid);
  state.units = state.units.filter((u) => !destroyed.includes(u.uid));

  return { attackerDamage: attackerPower, counterDamage, destroyed, notes };
}

/** Победа определяется прочностью штабов. */
export function checkWinner(state: GameState): PlayerId | null {
  if (state.players[0].hq.hp <= 0) return 1;
  if (state.players[1].hq.hp <= 0) return 0;
  return null;
}

export function squadsIncome(squads: SquadState[]): number {
  return squads.reduce((sum, s) => sum + s.income, 0);
}

export function isHqPosition(state: GameState, player: PlayerId, pos: { row: number; col: number }) {
  void state;
  return samePos(HQ_POSITIONS[player], pos);
}

export { opponentOf };
