// Действия игрока и генерация списка легальных ходов.
//
// getLegalActions — единственный источник истины о допустимости хода.
// Им пользуются и интерфейс, и все реализации ИИ, включая режим нейросети:
// модель выбирает ход из этого списка, поэтому сходить не по правилам она не может.

import type { Position } from '@wotg/shared';
import type { AttackerRef, TargetRef } from './combat.js';
import type { GameState, PlayerId, UnitState } from './state.js';
import { HQ_POSITIONS, bridgehead, isOccupied, neighbours, opponentOf, playerState, samePos, unitAt }
  from './state.js';
import { hasKeyword, isSpotted, legalSteps } from './rules.js';

export type Action =
  | { type: 'deploy'; cardIndex: number; pos: Position }
  | { type: 'deploySquad'; cardIndex: number }
  | { type: 'playOrder'; cardIndex: number; target?: TargetRef }
  | { type: 'move'; uid: string; to: Position }
  | { type: 'attack'; attacker: AttackerRef; target: TargetRef }
  | { type: 'endTurn' };

/** Описание карты, необходимое генератору ходов, без обращения к базе на каждом шаге. */
export interface CardView {
  name: string;
  kind: 'vehicle' | 'hq' | 'platoon' | 'order';
  cost: number;
  vehicleClass: string | null;
  platoonSpec: string | null;
  keywords: string[];
}

export type CardResolver = (state: GameState, player: PlayerId, cardName: string) => CardView;

/** Цена розыгрыша с учётом «Арьергарда»: последняя карта в руке играется бесплатно. */
export function playCost(view: CardView, handSize: number): number {
  if (view.keywords.includes('rearguard') && handSize === 1) return 0;
  return view.cost;
}

/** Может ли техника атаковать указанную цель. */
export function canUnitAttack(state: GameState, unit: UnitState, target: TargetRef): boolean {
  if (unit.attacksUsed > 0) return false;
  const enemy = opponentOf(unit.owner);

  if (target.kind === 'hq') {
    if (target.player !== enemy) return false;
    // Штаб атакуется вплотную — он стоит на угловой клетке поля.
    return neighbours(unit.pos).some((p) => samePos(p, HQ_POSITIONS[enemy]));
  }

  const victim = state.units.find((u) => u.uid === target.uid);
  if (!victim || victim.owner === unit.owner) return false;

  // САУ бьёт любую обнаруженную цель на поле; остальные классы — только вплотную.
  if (unit.vehicleClass === 'spg') {
    if (hasKeyword(victim, 'camouflage')) return false; // «Маскировка» защищает от САУ
    return isSpotted(state, victim, unit.owner);
  }
  return neighbours(unit.pos).some((p) => samePos(p, victim.pos));
}

/** Может ли штаб атаковать цель: только обнаруженную и незамаскированную. */
export function canHqAttack(state: GameState, player: PlayerId, target: TargetRef): boolean {
  const hq = playerState(state, player).hq;
  if (hq.attacksUsed > 0) return false;
  const enemy = opponentOf(player);

  if (target.kind === 'hq') {
    if (target.player !== enemy) return false;
    return !playerState(state, enemy).hq.keywords.includes('camouflage');
  }

  const victim = state.units.find((u) => u.uid === target.uid);
  if (!victim || victim.owner === player) return false;
  if (hasKeyword(victim, 'camouflage')) return false;
  return isSpotted(state, victim, player);
}

/**
 * Полный список ходов, доступных текущему игроку.
 * Ход «завершить ход» присутствует всегда — партия не может зайти в тупик.
 */
export function getLegalActions(
  state: GameState,
  resolve: CardResolver,
): Action[] {
  if (state.winner !== null) return [];

  const player = state.current;
  const me = playerState(state, player);
  const enemy = opponentOf(player);
  const actions: Action[] = [];

  // ── Розыгрыш карт из руки ────────────────────────────────────────────────
  const freeBridgehead = bridgehead(player).filter((p) => !isOccupied(state, p));
  const seenCards = new Set<string>();

  me.hand.forEach((cardName, index) => {
    const view = resolve(state, player, cardName);
    const cost = playCost(view, me.hand.length);
    if (cost > me.resources) return;

    // Одинаковые карты в руке дают одинаковые ходы — достаточно одной из них.
    const key = `${cardName}`;
    if (seenCards.has(key)) return;
    seenCards.add(key);

    if (view.kind === 'vehicle') {
      for (const pos of freeBridgehead) actions.push({ type: 'deploy', cardIndex: index, pos });
    } else if (view.kind === 'platoon') {
      actions.push({ type: 'deploySquad', cardIndex: index });
    } else if (view.kind === 'order') {
      actions.push({ type: 'playOrder', cardIndex: index });
    }
  });

  // ── Перемещение ──────────────────────────────────────────────────────────
  for (const unit of state.units) {
    if (unit.owner !== player) continue;
    for (const to of legalSteps(state, unit)) actions.push({ type: 'move', uid: unit.uid, to });
  }

  // ── Атаки техникой ───────────────────────────────────────────────────────
  for (const unit of state.units) {
    if (unit.owner !== player) continue;
    const attacker: AttackerRef = { kind: 'unit', uid: unit.uid };

    for (const victim of state.units) {
      if (victim.owner === player) continue;
      const target: TargetRef = { kind: 'unit', uid: victim.uid };
      if (canUnitAttack(state, unit, target)) actions.push({ type: 'attack', attacker, target });
    }
    const hqTarget: TargetRef = { kind: 'hq', player: enemy };
    if (canUnitAttack(state, unit, hqTarget)) {
      actions.push({ type: 'attack', attacker, target: hqTarget });
    }
  }

  // ── Атака штабом ─────────────────────────────────────────────────────────
  const hqAttacker: AttackerRef = { kind: 'hq', player };
  for (const victim of state.units) {
    if (victim.owner === player) continue;
    const target: TargetRef = { kind: 'unit', uid: victim.uid };
    if (canHqAttack(state, player, target)) actions.push({ type: 'attack', attacker: hqAttacker, target });
  }
  const enemyHq: TargetRef = { kind: 'hq', player: enemy };
  if (canHqAttack(state, player, enemyHq)) {
    actions.push({ type: 'attack', attacker: hqAttacker, target: enemyHq });
  }

  actions.push({ type: 'endTurn' });
  return actions;
}

/** Занята ли клетка — вынесено для интерфейса. */
export function cellOccupant(state: GameState, pos: Position): UnitState | undefined {
  return unitAt(state, pos);
}
