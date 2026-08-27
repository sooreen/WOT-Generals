// Создание программного оппонента по уровню сложности.
//
// Режим 'llm' здесь намеренно не поддерживается: агент на нейросети требует
// серверного окружения и создаётся в apps/server через @wotg/ai/llm.

import { GeneralAgent, OfficerAgent, RecruitAgent, SergeantAgent } from './agents.js';
import type { Agent, Difficulty } from './types.js';

export type OpponentMode = Difficulty | 'llm';

/** Для режима 'llm' возвращается «Офицер» — клиент в этом случае идёт на сервер. */
export function createAgent(mode: OpponentMode): Agent {
  switch (mode) {
    case 'recruit':
      return new RecruitAgent();
    case 'sergeant':
      return new SergeantAgent();
    case 'officer':
    case 'llm':
      return new OfficerAgent(3);
    case 'general':
      return new GeneralAgent();
  }
}
