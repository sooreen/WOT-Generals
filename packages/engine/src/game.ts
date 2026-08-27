// Движок правил: создание боя и применение действий.
//
// reduce(state, action) → новое состояние. Функция чистая: входное состояние
// не изменяется, весь случайный выбор идёт через seed внутри состояния.
// Благодаря этому партия воспроизводится по seed, а самоигра ИИ повторяема.

import type { CardDef, GameData, Keyword, PlatoonBonus, PlatoonSpec, Position, VehicleClass }
  from '@wotg/shared';
import { HAND_LIMIT, STARTING_HAND } from '@wotg/shared';
import type { Action, CardResolver, CardView } from './actions.js';
import { getLegalActions, playCost } from './actions.js';
import { applyDamageToHQ, checkWinner, resolveAttack } from './combat.js';
import { effectiveStats, type HqContext } from './cards.js';
import { movementAllowance, stepCost } from './rules.js';
import { nextInt, shuffle, type RngState } from './rng.js';
import type { GameState, PlayerId, PlayerState, SquadState, UnitState } from './state.js';
import { HQ_POSITIONS, opponentOf, playerState } from './state.js';

export interface DeckSpec {
  hq: string;
  cards: string[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hqContext(p: PlayerState): HqContext {
  return { nation: p.hq.nation, hqType: p.hq.hqType, tier: p.hq.tier };
}

/** Представление карты для генератора ходов с учётом штаба владельца. */
export function makeResolver(data: GameData): CardResolver {
  return (state: GameState, player: PlayerId, cardName: string): CardView => {
    const card = data.byName.get(cardName);
    if (!card) {
      return { name: cardName, kind: 'order', cost: 0, vehicleClass: null, platoonSpec: null, keywords: [] };
    }
    const stats = effectiveStats(data, card, hqContext(playerState(state, player)));
    return {
      name: cardName,
      kind: card.kind,
      cost: stats.cost,
      vehicleClass: card.vehicleClass,
      platoonSpec: card.platoonSpec,
      keywords: stats.keywords,
    };
  };
}

function makeHqState(data: GameData, hqName: string, player: PlayerId) {
  const card = data.byName.get(hqName);
  if (!card) throw new Error(`Штаб не найден в базе: ${hqName}`);
  if (card.kind !== 'hq') throw new Error(`Карта «${hqName}» не является штабом`);

  const ctx: HqContext = {
    nation: card.nation ?? 'ussr',
    hqType: card.hqType ?? 'training',
    tier: card.tier ?? 1,
  };
  const stats = effectiveStats(data, card, ctx);

  return {
    cardName: card.name,
    nation: ctx.nation,
    hqType: ctx.hqType,
    tier: ctx.tier,
    hp: stats.hp,
    maxHp: stats.hp,
    attack: stats.attack,
    income: stats.income,
    pos: HQ_POSITIONS[player],
    attacksUsed: 0,
    keywords: stats.keywords,
  };
}

export function createGame(
  data: GameData,
  decks: [DeckSpec, DeckSpec],
  seed = 1,
): GameState {
  let rng: RngState = { seed };

  const players = [0, 1].map((i) => {
    const id = i as PlayerId;
    const spec = decks[id];
    const shuffled = shuffle(spec.cards, rng);
    rng = shuffled.state;

    return {
      id,
      hq: makeHqState(data, spec.hq, id),
      hand: shuffled.items.slice(0, STARTING_HAND),
      deck: shuffled.items.slice(STARTING_HAND),
      casualties: [],
      squads: [],
      resources: 0,
    } as PlayerState;
  }) as [PlayerState, PlayerState];

  // «Первый ход определяется случайно в каждом бою».
  const first = nextInt(rng, 2);
  rng = first.state;

  const state: GameState = {
    players,
    units: [],
    current: first.value as PlayerId,
    turn: 0,
    rng,
    winner: null,
    endReason: null,
    log: [],
    nextUid: 1,
  };

  return beginTurn(state, data, true);
}

function log(state: GameState, text: string): void {
  state.log.push({ turn: state.turn, player: state.current, text });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

/** Прирост ресурсов: штаб плюс вся своя техника на поле и взводы в зоне поддержки. */
export function totalIncome(state: GameState, player: PlayerId): number {
  const p = playerState(state, player);
  const units = state.units.filter((u) => u.owner === player).reduce((s, u) => s + u.income, 0);
  const squads = p.squads.reduce((s, sq) => s + sq.income, 0);
  return p.hq.income + units + squads;
}

function drawCard(state: GameState, player: PlayerId): void {
  const p = playerState(state, player);
  if (p.deck.length === 0) return; // колода пуста — карта просто не приходит
  const card = p.deck.shift() as string;
  p.hand.push(card);
}

/** Начало хода: сброс флагов, ресурсы, добор карты, проверка триггеров. */
function beginTurn(state: GameState, data: GameData, isFirstTurnOfGame: boolean): GameState {
  state.turn++;
  const player = state.current;
  const enemy = opponentOf(player);

  for (const unit of state.units) {
    if (unit.owner === player) {
      unit.attacksUsed = 0;
      unit.deployedThisTurn = false;
      unit.moveBlocked = false;
      unit.movesLeft = movementAllowance(unit);
    } else {
      // Контратака восстанавливается к ходу противника: «1 раз за ход».
      unit.counterUsed = false;
    }
  }
  playerState(state, player).hq.attacksUsed = 0;
  void enemy;

  // «Ресурсы, не потраченные за ход, сгорают в начале вашего следующего хода»:
  // запас именно устанавливается, а не накапливается.
  playerState(state, player).resources = totalIncome(state, player);

  // «Ходящий первым в первом раунде не получает дополнительную карту».
  if (!isFirstTurnOfGame) drawCard(state, player);

  applyTurnStartTriggers(state, data, player);

  log(state, `Ход ${state.turn}: игрок ${player + 1}, ресурсов ${playerState(state, player).resources}`);
  return state;
}

/** Триггеры «в начале хода» у техники и взводов текущего игрока. */
function applyTurnStartTriggers(state: GameState, data: GameData, player: PlayerId): void {
  const p = playerState(state, player);
  const ctx = hqContext(p);

  const owned: Array<{ cardName: string; unit?: UnitState; squad?: SquadState }> = [
    ...state.units.filter((u) => u.owner === player).map((u) => ({ cardName: u.cardName, unit: u })),
    ...p.squads.map((s) => ({ cardName: s.cardName, squad: s })),
  ];

  for (const entry of owned) {
    for (const ability of data.abilities[entry.cardName] ?? []) {
      if (ability.condition && !conditionMatches(ability.condition, ctx)) continue;
      for (const clause of ability.clauses) {
        if (clause.op !== 'trigger' || clause.on !== 'turnStart') continue;
        applyEffects(state, player, clause.effects as EffectSpec[], entry);
      }
    }
  }
}

function conditionMatches(condition: { hqNation?: string; hqType?: string }, ctx: HqContext): boolean {
  if (condition.hqNation && condition.hqNation !== ctx.nation) return false;
  if (condition.hqType && condition.hqType !== ctx.hqType) return false;
  return true;
}

interface EffectSpec {
  op: string;
  amount?: number;
  target?: string;
  keyword?: Keyword;
  [key: string]: unknown;
}

/** Исполнение эффектов DSL. Неизвестные операции игнорируются и пишутся в лог. */
function applyEffects(
  state: GameState,
  player: PlayerId,
  effects: EffectSpec[],
  source: { cardName: string; unit?: UnitState; squad?: SquadState },
): void {
  const me = playerState(state, player);
  const enemy = opponentOf(player);
  const foe = playerState(state, enemy);
  const notes: string[] = [];

  for (const effect of effects) {
    const amount = Number(effect.amount ?? 0);

    switch (effect.op) {
      case 'damage': {
        if (effect.target === 'enemyHQ') applyDamageToHQ(state, enemy, amount, notes);
        else if (effect.target === 'ownHQ') applyDamageToHQ(state, player, amount, notes);
        else if (effect.target === 'allEnemyVehicles') {
          for (const u of state.units.filter((u) => u.owner === enemy)) u.hp -= amount;
          state.units = state.units.filter((u) => u.hp > 0);
        }
        break;
      }
      case 'heal': {
        if (effect.target === 'ownHQ') me.hq.hp = Math.min(me.hq.maxHp, me.hq.hp + amount);
        else if (effect.target === 'self') {
          if (source.unit) source.unit.hp = Math.min(source.unit.maxHp, source.unit.hp + amount);
          if (source.squad) source.squad.hp = Math.min(source.squad.maxHp, source.squad.hp + amount);
        }
        break;
      }
      case 'draw':
        for (let i = 0; i < Math.max(1, amount); i++) drawCard(state, player);
        break;
      case 'mill': {
        const victim = effect.target === 'self' ? me : foe;
        for (let i = 0; i < Math.max(1, amount); i++) {
          const c = victim.deck.shift();
          if (c) victim.casualties.push(c);
        }
        break;
      }
      case 'discardFromHand': {
        const targets = effect.target === 'both' ? [me, foe] : [foe];
        for (const t of targets) {
          for (let i = 0; i < Math.max(1, amount) && t.hand.length; i++) {
            const r = nextInt(state.rng, t.hand.length);
            state.rng = r.state;
            const [card] = t.hand.splice(r.value, 1);
            if (card) t.casualties.push(card);
          }
        }
        break;
      }
      case 'recoverFromCasualties': {
        for (let i = 0; i < Math.max(1, amount) && me.casualties.length; i++) {
          const r = nextInt(state.rng, me.casualties.length);
          state.rng = r.state;
          const [card] = me.casualties.splice(r.value, 1);
          if (card) me.deck.push(card);
        }
        break;
      }
      case 'gainResources':
        me.resources += amount;
        break;
      case 'destroy': {
        if (effect.target === 'self' && source.unit) {
          state.units = state.units.filter((u) => u.uid !== source.unit?.uid);
          me.casualties.push(source.cardName);
        } else if (effect.target === 'self' && source.squad) {
          me.squads = me.squads.filter((s) => s.uid !== source.squad?.uid);
          me.casualties.push(source.cardName);
        }
        break;
      }
      case 'removeKeyword': {
        const kw = effect.keyword as Keyword;
        if (effect.target === 'enemyVehicles') {
          for (const u of state.units.filter((u) => u.owner === enemy)) {
            u.keywords = u.keywords.filter((k) => k !== kw);
          }
        }
        break;
      }
      case 'grantKeyword': {
        const kw = effect.keyword as Keyword;
        if (effect.target === 'ownHQ') {
          if (!me.hq.keywords.includes(kw)) me.hq.keywords.push(kw);
        } else if (source.unit && !source.unit.keywords.includes(kw)) {
          source.unit.keywords.push(kw);
        }
        break;
      }
      case 'spot':
        // Обнаружение вычисляется динамически; постоянного флага в состоянии нет.
        break;
      default:
        // Операции, не поддержанные движком (coverage: partial/none в data/abilities.json).
        break;
    }
  }

  for (const n of notes) log(state, n);
}

/** Триггеры конкретного события у одной карты. */
function fireTrigger(
  state: GameState,
  data: GameData,
  player: PlayerId,
  event: string,
  source: { cardName: string; unit?: UnitState; squad?: SquadState },
): void {
  const ctx = hqContext(playerState(state, player));
  for (const ability of data.abilities[source.cardName] ?? []) {
    if (ability.condition && !conditionMatches(ability.condition, ctx)) continue;
    for (const clause of ability.clauses) {
      const isPlay = clause.op === 'onPlay' && event === 'play';
      const isTrigger = clause.op === 'trigger' && clause.on === event;
      if (!isPlay && !isTrigger) continue;
      applyEffects(state, player, clause.effects as EffectSpec[], source);
    }
  }
}

function makeUnit(
  data: GameData,
  card: CardDef,
  player: PlayerId,
  pos: Position,
  uid: string,
  ctx: HqContext,
): UnitState {
  const stats = effectiveStats(data, card, ctx);
  const unit: UnitState = {
    uid,
    cardName: card.name,
    owner: player,
    pos,
    hp: stats.hp,
    maxHp: stats.hp,
    attack: stats.attack,
    income: stats.income,
    vehicleClass: (card.vehicleClass ?? 'medium') as VehicleClass,
    keywords: stats.keywords,
    attacksUsed: 0,
    counterUsed: false,
    movesLeft: 0,
    deployedThisTurn: true,
    moveBlocked: false,
  };
  unit.movesLeft = movementAllowance(unit);
  return unit;
}

function makeSquad(
  data: GameData,
  card: CardDef,
  player: PlayerId,
  uid: string,
  ctx: HqContext,
): SquadState {
  const stats = effectiveStats(data, card, ctx);
  return {
    uid,
    cardName: card.name,
    owner: player,
    spec: (card.platoonSpec ?? 'recon') as PlatoonSpec,
    bonus: (card.platoonBonus ?? 'defence') as PlatoonBonus,
    hp: stats.hp,
    maxHp: stats.hp,
    support: stats.support,
    income: stats.income,
    keywords: stats.keywords,
  };
}

/** Применение действия. Возвращает НОВОЕ состояние; исходное не изменяется. */
export function reduce(state: GameState, action: Action, data: GameData): GameState {
  if (state.winner !== null) return state;
  const next = clone(state);
  const player = next.current;
  const me = playerState(next, player);
  const ctx = hqContext(me);

  switch (action.type) {
    case 'deploy': {
      const cardName = me.hand[action.cardIndex];
      if (!cardName) return state;
      const card = data.byName.get(cardName);
      if (!card || card.kind !== 'vehicle') return state;

      const stats = effectiveStats(data, card, ctx);
      const cost = playCost(
        { name: cardName, kind: 'vehicle', cost: stats.cost, vehicleClass: card.vehicleClass, platoonSpec: null, keywords: stats.keywords },
        me.hand.length,
      );
      if (cost > me.resources) return state;

      me.resources -= cost;
      me.hand.splice(action.cardIndex, 1);
      const unit = makeUnit(data, card, player, action.pos, `u${next.nextUid++}`, ctx);
      next.units.push(unit);
      log(next, `Выведен ${card.name} на (${action.pos.row},${action.pos.col}) за ${cost}`);

      if (stats.keywords.includes('reinforcements')) drawCard(next, player);
      fireTrigger(next, data, player, 'play', { cardName: card.name, unit });
      fireTrigger(next, data, player, 'deploy', { cardName: card.name, unit });
      break;
    }

    case 'deploySquad': {
      const cardName = me.hand[action.cardIndex];
      if (!cardName) return state;
      const card = data.byName.get(cardName);
      if (!card || card.kind !== 'platoon') return state;

      const stats = effectiveStats(data, card, ctx);
      const cost = playCost(
        { name: cardName, kind: 'platoon', cost: stats.cost, vehicleClass: null, platoonSpec: card.platoonSpec, keywords: stats.keywords },
        me.hand.length,
      );
      if (cost > me.resources) return state;

      me.resources -= cost;
      me.hand.splice(action.cardIndex, 1);

      // «Если разыгрывается взвод уже имеющейся специализации,
      //  то карта, поддерживающая штаб, отправится в потери».
      const spec = card.platoonSpec ?? 'recon';
      const existing = me.squads.find((s) => s.spec === spec);
      if (existing) {
        me.squads = me.squads.filter((s) => s.uid !== existing.uid);
        me.casualties.push(existing.cardName);
        log(next, `Взвод ${existing.cardName} заменён (специализация занята)`);
      }

      const squad = makeSquad(data, card, player, `s${next.nextUid++}`, ctx);
      me.squads.push(squad);
      log(next, `Разыгран взвод ${card.name} за ${cost}`);

      if (stats.keywords.includes('reinforcements')) drawCard(next, player);
      fireTrigger(next, data, player, 'play', { cardName: card.name, squad });
      break;
    }

    case 'playOrder': {
      const cardName = me.hand[action.cardIndex];
      if (!cardName) return state;
      const card = data.byName.get(cardName);
      if (!card || card.kind !== 'order') return state;

      const stats = effectiveStats(data, card, ctx);
      const cost = playCost(
        { name: cardName, kind: 'order', cost: stats.cost, vehicleClass: null, platoonSpec: null, keywords: stats.keywords },
        me.hand.length,
      );
      if (cost > me.resources) return state;

      me.resources -= cost;
      me.hand.splice(action.cardIndex, 1);
      // «Приказы действуют мгновенно и сразу после розыгрыша отправляются в потери».
      me.casualties.push(card.name);
      log(next, `Разыгран приказ ${card.name} за ${cost}`);
      fireTrigger(next, data, player, 'play', { cardName: card.name });
      break;
    }

    case 'move': {
      const unit = next.units.find((u) => u.uid === action.uid);
      if (!unit || unit.owner !== player) return state;
      const cost = stepCost(unit, action.to);
      unit.pos = action.to;
      unit.movesLeft = Math.max(0, unit.movesLeft - cost);
      break;
    }

    case 'attack': {
      // Имена участников берём ДО боя: уничтоженные карты исчезают из состояния.
      // Ссылки разбираются заранее, потому что внутри тернарного выражения
      // TypeScript не сужает размеченное объединение по полю kind.
      const attackerRef = action.attacker;
      const targetRef = action.target;
      const nameOfUnit = (uid: string) =>
        state.units.find((u) => u.uid === uid)?.cardName ?? 'техника';

      const attackerName =
        attackerRef.kind === 'hq' ? `штаб ${me.hq.cardName}` : nameOfUnit(attackerRef.uid);
      const targetName =
        targetRef.kind === 'hq'
          ? `штаб ${playerState(state, targetRef.player).hq.cardName}`
          : nameOfUnit(targetRef.uid);

      const result = resolveAttack(next, action.attacker, action.target);
      log(next, `${attackerName} атакует ${targetName} на ${result.attackerDamage}`);
      for (const note of result.notes) log(next, note);

      // Уничтоженная техника уходит в потери своего владельца.
      for (const uid of result.destroyed) {
        const dead = state.units.find((u) => u.uid === uid);
        if (dead) playerState(next, dead.owner).casualties.push(dead.cardName);
      }

      if (action.attacker.kind === 'unit') {
        const attackerUid = action.attacker.uid;
        const attacker = next.units.find((u) => u.uid === attackerUid);
        if (attacker) {
          fireTrigger(next, data, player, 'attack', { cardName: attacker.cardName, unit: attacker });
          fireTrigger(next, data, player, 'afterAttack', { cardName: attacker.cardName, unit: attacker });
        }
      }
      if (result.destroyed.length) {
        // Триггеры «когда уничтожается техника противника» у всех своих карт.
        for (const u of next.units.filter((u) => u.owner === player)) {
          fireTrigger(next, data, player, 'enemyVehicleDestroyed', { cardName: u.cardName, unit: u });
        }
        fireTrigger(next, data, player, 'enemyVehicleDestroyed', { cardName: me.hq.cardName });
      }
      break;
    }

    case 'endTurn': {
      // «Если в конце хода в руке больше шести карт, лишние сбрасываются случайно».
      while (me.hand.length > HAND_LIMIT) {
        const r = nextInt(next.rng, me.hand.length);
        next.rng = r.state;
        const [card] = me.hand.splice(r.value, 1);
        if (card) me.casualties.push(card);
      }
      for (const u of next.units.filter((u) => u.owner === player)) {
        fireTrigger(next, data, player, 'turnEnd', { cardName: u.cardName, unit: u });
      }

      next.current = opponentOf(player);
      const winner = checkWinner(next);
      if (winner !== null) {
        next.winner = winner;
        next.endReason = 'Штаб уничтожен';
        return next;
      }
      return beginTurn(next, data, false);
    }
  }

  const winner = checkWinner(next);
  if (winner !== null) {
    next.winner = winner;
    next.endReason = 'Штаб уничтожен';
  }
  return next;
}

export { getLegalActions };
