// Оппонент на нейросети.
//
// Ключевая идея: модель НЕ придумывает ход с нуля. Движок формирует список
// легальных ходов, модель выбирает из него номер. Поэтому нелегальный ход
// невозможен в принципе, а любой сбой (нет ключа, таймаут, мусор в ответе)
// переводит партию на программный ИИ без прерывания игры.

import Anthropic from '@anthropic-ai/sdk';
import type { Action, GameState } from '@wotg/engine';
import { getLegalActions, makeResolver } from '@wotg/engine';
import type { GameData } from '@wotg/shared';
import { OfficerAgent } from './agents.js';
import { describeAction, describeState } from './describe.js';
import type { Agent } from './types.js';

export interface LlmAgentOptions {
  apiKey?: string;
  model?: string;
  /** Ограничение на число ходов в списке: длинный список ухудшает выбор и стоит дороже. */
  maxOptions?: number;
  timeoutMs?: number;
  effort?: 'low' | 'medium' | 'high';
  onFallback?: (reason: string) => void;
}

const MOVE_TOOL: Anthropic.Tool = {
  name: 'choose_move',
  description: 'Выбрать ход из предложенного списка по его номеру.',
  input_schema: {
    type: 'object',
    properties: {
      move: {
        type: 'integer',
        description: 'Номер хода из списка (нумерация с 1).',
      },
      reason: {
        type: 'string',
        description: 'Краткое обоснование выбора, одно предложение.',
      },
    },
    required: ['move', 'reason'],
    additionalProperties: false,
  },
  strict: true,
};

const SYSTEM_PROMPT = `Ты играешь в пошаговую карточную игру World of Tanks Generals за одного из генералов.

Правила, которые важны для выбора хода:
— Поле 3×5. Штабы стоят в противоположных углах. Побеждает тот, кто обнулит прочность вражеского штаба.
— Технику можно выводить только на плацдарм — три клетки вокруг своего штаба.
— Атаковать можно только обнаруженную технику: она должна стоять вплотную (одна из 8 соседних клеток) к твоей карте или штабу.
— При атаке цель контратакует, и урон наносится одновременно. Размен невыгоден, если ты теряешь больше, чем противник.
— ПТ-САУ бьёт первой: если её урона хватает на уничтожение, она не получает ответа.
— САУ и штаб бьют дистанционно и не получают контратак, но не пробивают «Маскировку».
— Тяжёлый танк, атаковавший в свой ход, не сможет контратаковать в чужой.
— Неистраченные ресурсы сгорают в начале следующего хода — старайся тратить их полностью.

Выбирай ход, который выгоднее всего в долгую: дави на вражеский штаб, но не подставляй технику под невыгодный размен.
Всегда вызывай инструмент choose_move и указывай номер строго из предложенного списка.`;

export class LlmAgent implements Agent {
  readonly name = 'Нейросеть';

  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly maxOptions: number;
  private readonly timeoutMs: number;
  private readonly effort: 'low' | 'medium' | 'high';
  private readonly fallback = new OfficerAgent(2);
  private readonly onFallback: (reason: string) => void;

  constructor(options: LlmAgentOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    // Клиент создаётся только при наличии ключа: без него агент молча работает
    // как «Офицер», и игра остаётся полностью играбельной.
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = options.model ?? process.env.WOTG_LLM_MODEL ?? 'claude-opus-5';
    this.maxOptions = options.maxOptions ?? 40;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.effort = options.effort ?? 'medium';
    this.onFallback = options.onFallback ?? (() => {});
  }

  get available(): boolean {
    return this.client !== null;
  }

  async chooseAction(state: GameState, data: GameData): Promise<Action> {
    const actions = getLegalActions(state, makeResolver(data));
    if (!actions.length) return { type: 'endTurn' };
    if (actions.length === 1) return actions[0] as Action;

    if (!this.client) {
      this.onFallback('нет ключа ANTHROPIC_API_KEY');
      return this.fallback.chooseAction(state, data);
    }

    // Список ходов урезаем: слишком длинный перечень и дороже, и хуже для выбора.
    const options = actions.slice(0, this.maxOptions);
    const prompt = [
      describeState(state, data),
      '',
      'Доступные ходы:',
      ...options.map((a, i) => `${i + 1}. ${describeAction(state, a, data)}`),
      '',
      `Выбери номер от 1 до ${options.length}.`,
    ].join('\n');

    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          output_config: { effort: this.effort },
          tools: [MOVE_TOOL],
          tool_choice: { type: 'tool', name: 'choose_move' },
          messages: [{ role: 'user', content: prompt }],
        },
        { timeout: this.timeoutMs },
      );

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        this.onFallback('модель не вызвала инструмент выбора хода');
        return this.fallback.chooseAction(state, data);
      }

      const input = toolUse.input as { move?: number };
      const index = Number(input.move) - 1;

      // Ответ модели — данные, а не команда: индекс обязан попасть в список,
      // который сформировал движок.
      if (!Number.isInteger(index) || index < 0 || index >= options.length) {
        this.onFallback(`модель вернула недопустимый номер хода: ${input.move}`);
        return this.fallback.chooseAction(state, data);
      }

      return options[index] as Action;
    } catch (error) {
      const message =
        error instanceof Anthropic.APIError
          ? `ошибка API ${error.status}: ${error.message}`
          : `сбой запроса: ${String(error)}`;
      this.onFallback(message);
      return this.fallback.chooseAction(state, data);
    }
  }
}
