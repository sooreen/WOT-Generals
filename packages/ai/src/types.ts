import type { Action, GameState } from '@wotg/engine';
import type { GameData } from '@wotg/shared';

/** Уровни сложности. Значения используются и в интерфейсе, и в настройках сервера. */
export type Difficulty = 'recruit' | 'sergeant' | 'officer' | 'general';

export const DIFFICULTY_RU: Record<Difficulty, string> = {
  recruit: 'Новобранец',
  sergeant: 'Сержант',
  officer: 'Офицер',
  general: 'Генерал',
};

export const DIFFICULTY_DESCRIPTION: Record<Difficulty, string> = {
  recruit: 'Случайные разумные ходы. Подходит, чтобы освоить правила.',
  sergeant: 'Жадная оценка на один полуход: разменивает выгодно и давит на штаб.',
  officer: 'Поиск на несколько полуходов со случайной подстановкой скрытых карт.',
  general: 'Поиск методом Монте-Карло с настроенной оценкой позиции.',
};

/**
 * Единый интерфейс оппонента. Все реализации взаимозаменяемы, включая режим
 * нейросети: сервер подставляет любую из них, не меняя остальной код.
 */
export interface Agent {
  readonly name: string;
  chooseAction(state: GameState, data: GameData): Promise<Action> | Action;
}
