// Программные оппоненты четырёх уровней сложности.
//
// Все агенты выбирают ход только из getLegalActions, поэтому нелегальный ход
// физически невозможен. Различаются они глубиной анализа, а не набором правил.

import type { Action, GameState, PlayerId } from '@wotg/engine';
import { getLegalActions, makeResolver, nextInt, reduce, shuffle, type RngState } from '@wotg/engine';
import type { GameData } from '@wotg/shared';
import { DEFAULT_WEIGHTS, evaluate, type EvalWeights } from './evaluate.js';
import type { Agent } from './types.js';

/** Ход противника моделируется дешёвым жадным откликом, иначе поиск слишком дорог. */
const OPPONENT_REPLY_SAMPLES = 6;

function rngFrom(state: GameState, salt: number): RngState {
  return { seed: (state.rng.seed ^ (salt * 2654435761)) | 0 };
}

function pickRandom<T>(items: T[], rng: RngState): { item: T; rng: RngState } {
  const r = nextInt(rng, items.length);
  return { item: items[r.value] as T, rng: r.state };
}

/** Ходы, которые почти всегда бессмысленны: помогает всем уровням не выглядеть глупо. */
function isObviouslyBad(state: GameState, action: Action, data: GameData, me: PlayerId): boolean {
  if (action.type !== 'attack') return false;
  const after = reduce(state, action, data);
  return evaluate(after, me) < evaluate(state, me) - 6;
}

// ── Уровень 1: Новобранец ────────────────────────────────────────────────────
export class RecruitAgent implements Agent {
  readonly name = 'Новобранец';

  chooseAction(state: GameState, data: GameData): Action {
    const me = state.current;
    const actions = getLegalActions(state, makeResolver(data));
    const useful = actions.filter((a) => a.type !== 'endTurn');
    if (!useful.length) return { type: 'endTurn' };

    // Отсеиваем явные самоубийства, но в остальном ходим наугад.
    const sane = useful.filter((a) => !isObviouslyBad(state, a, data, me));
    const pool = sane.length ? sane : useful;

    let rng = rngFrom(state, state.turn + 1);
    // Иногда заканчиваем ход раньше — иначе новобранец выкладывает всё подряд.
    const r = nextInt(rng, 100);
    rng = r.state;
    if (r.value < 15) return { type: 'endTurn' };

    return pickRandom(pool, rng).item;
  }
}

// ── Уровень 2: Сержант ───────────────────────────────────────────────────────
export class SergeantAgent implements Agent {
  readonly name = 'Сержант';
  constructor(private readonly weights: EvalWeights = DEFAULT_WEIGHTS) {}

  chooseAction(state: GameState, data: GameData): Action {
    const me = state.current;
    const actions = getLegalActions(state, makeResolver(data));

    let best: Action = { type: 'endTurn' };
    let bestScore = evaluate(state, me, this.weights);

    for (const action of actions) {
      if (action.type === 'endTurn') continue;
      const score = evaluate(reduce(state, action, data), me, this.weights);
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
    return best;
  }
}

// ── Уровень 3: Офицер ────────────────────────────────────────────────────────
/**
 * Просмотр на несколько своих ходов вперёд с учётом ответа противника.
 * Рука и колода противника скрыты, поэтому его ответ оценивается жадно —
 * это детерминизация скрытой информации в простейшей форме.
 */
export class OfficerAgent implements Agent {
  readonly name = 'Офицер';
  constructor(
    private readonly depth = 3,
    private readonly weights: EvalWeights = DEFAULT_WEIGHTS,
  ) {}

  chooseAction(state: GameState, data: GameData): Action {
    const me = state.current;
    const actions = getLegalActions(state, makeResolver(data));

    let best: Action = { type: 'endTurn' };
    let bestScore = -Infinity;

    for (const action of actions) {
      const score = this.search(reduce(state, action, data), data, me, this.depth - 1);
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
    return best;
  }

  private search(state: GameState, data: GameData, me: PlayerId, depth: number): number {
    if (state.winner !== null || depth <= 0) return evaluate(state, me, this.weights);

    // Ход перешёл к противнику — оцениваем его лучший жадный ответ.
    if (state.current !== me) return this.opponentReply(state, data, me, depth);

    const actions = getLegalActions(state, makeResolver(data));
    let best = -Infinity;
    for (const action of actions.slice(0, 24)) {
      const score = this.search(reduce(state, action, data), data, me, depth - 1);
      if (score > best) best = score;
    }
    return best === -Infinity ? evaluate(state, me, this.weights) : best;
  }

  private opponentReply(state: GameState, data: GameData, me: PlayerId, depth: number): number {
    const actions = getLegalActions(state, makeResolver(data));
    const foe = state.current;

    let worst = Infinity;
    for (const action of actions.slice(0, OPPONENT_REPLY_SAMPLES)) {
      const after = reduce(state, action, data);
      const score =
        after.current === me
          ? this.search(after, data, me, depth - 1)
          : evaluate(after, me, this.weights);
      // Противник выбирает ход, худший для нас.
      if (score < worst) worst = score;
      void foe;
    }
    return worst === Infinity ? evaluate(state, me, this.weights) : worst;
  }
}

// ── Уровень 4: Генерал ───────────────────────────────────────────────────────
/**
 * Поиск методом Монте-Карло: каждый ход-кандидат прогоняется несколькими
 * быстрыми случайными партиями, выбирается ход с лучшей средней оценкой.
 * Скрытая информация естественным образом усредняется по прогонам.
 */
export class GeneralAgent implements Agent {
  readonly name = 'Генерал';

  constructor(
    private readonly playouts = 24,
    private readonly playoutDepth = 14,
    private readonly weights: EvalWeights = DEFAULT_WEIGHTS,
  ) {}

  chooseAction(state: GameState, data: GameData): Action {
    const me = state.current;
    const actions = getLegalActions(state, makeResolver(data));
    if (actions.length === 1) return actions[0] as Action;

    // Сильные кандидаты по жадной оценке идут в поиск первыми: бюджет прогонов ограничен.
    const scored = actions
      .map((action) => ({ action, quick: evaluate(reduce(state, action, data), me, this.weights) }))
      .sort((a, b) => b.quick - a.quick)
      .slice(0, 10);

    let best: Action = { type: 'endTurn' };
    let bestAvg = -Infinity;

    for (const [i, candidate] of scored.entries()) {
      const after = reduce(state, candidate.action, data);
      let total = 0;
      for (let p = 0; p < this.playouts; p++) {
        total += this.playout(after, data, me, rngFrom(state, i * 1000 + p));
      }
      const avg = total / this.playouts;
      if (avg > bestAvg) {
        bestAvg = avg;
        best = candidate.action;
      }
    }
    return best;
  }

  private playout(start: GameState, data: GameData, me: PlayerId, seed: RngState): number {
    let state = start;
    let rng = seed;
    const resolver = makeResolver(data);

    for (let step = 0; step < this.playoutDepth; step++) {
      if (state.winner !== null) break;
      const actions = getLegalActions(state, resolver);
      if (!actions.length) break;

      // Случайная партия со смещением в сторону разумных ходов:
      // чистый рандом даёт слишком шумную оценку.
      const shuffled = shuffle(actions, rng);
      rng = shuffled.state;
      const sample = shuffled.items.slice(0, 5);

      const mover = state.current;
      let bestAction = sample[0] as Action;
      let bestScore = -Infinity;
      for (const action of sample) {
        const score = evaluate(reduce(state, action, data), mover, this.weights);
        if (score > bestScore) {
          bestScore = score;
          bestAction = action;
        }
      }
      state = reduce(state, bestAction, data);
    }
    return evaluate(state, me, this.weights);
  }
}
