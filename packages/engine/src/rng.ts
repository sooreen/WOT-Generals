// Детерминированный генератор случайных чисел.
//
// Партия должна воспроизводиться по seed: без этого нельзя ни отлаживать баги,
// ни прогонять самоигру ИИ, ни писать стабильные тесты на раздачу карт.
// Math.random() для этого не годится — состояние генератора хранится прямо в состоянии игры.

export interface RngState {
  seed: number;
}

/** mulberry32 — компактный PRNG с достаточным для игры качеством распределения. */
export function nextRandom(state: RngState): { value: number; state: RngState } {
  let t = (state.seed + 0x6d2b79f5) | 0;
  const seed = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: { seed } };
}

export function nextInt(state: RngState, maxExclusive: number): { value: number; state: RngState } {
  const r = nextRandom(state);
  return { value: Math.floor(r.value * maxExclusive), state: r.state };
}

/** Перемешивание Фишера—Йетса. Возвращает новый массив, исходный не трогает. */
export function shuffle<T>(items: readonly T[], state: RngState): { items: T[]; state: RngState } {
  const result = [...items];
  let rng = state;
  for (let i = result.length - 1; i > 0; i--) {
    const r = nextInt(rng, i + 1);
    rng = r.state;
    const j = r.value;
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return { items: result, state: rng };
}
