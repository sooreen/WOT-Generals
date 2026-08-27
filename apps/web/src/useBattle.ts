// Состояние боя в интерфейсе: применение ходов игрока и запуск хода противника.
//
// Движок чистый, поэтому весь игровой цикл живёт здесь: React хранит состояние,
// а ход ИИ выполняется асинхронно с небольшой паузой, иначе противник
// отыгрывает весь ход мгновенно и игрок не успевает понять, что произошло.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createGame, getLegalActions, makeResolver, reduce,
  type Action, type DeckSpec, type GameState,
} from '@wotg/engine';
import { createAgent, type OpponentMode } from '@wotg/ai';
import { gameData } from './data.js';

const AI_MOVE_DELAY_MS = 550;
const AI_MAX_ACTIONS_PER_TURN = 40; // страховка от зацикливания агента

export interface BattleSetup {
  decks: [DeckSpec, DeckSpec];
  mode: OpponentMode;
  seed: number;
}

export interface BattleApi {
  state: GameState;
  legalActions: Action[];
  aiThinking: boolean;
  aiNotice: string | null;
  perform(action: Action): void;
  restart(): void;
}

/** Ход противника ведёт нейросеть — решение принимает сервер, ключ остаётся у него. */
async function requestServerMove(state: GameState): Promise<Action | null> {
  try {
    const res = await fetch('/api/ai/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { action?: Action };
    return body.action ?? null;
  } catch {
    return null;
  }
}

export function useBattle(setup: BattleSetup): BattleApi {
  const resolver = useRef(makeResolver(gameData));
  const [state, setState] = useState<GameState>(() => createGame(gameData, setup.decks, setup.seed));
  const [aiThinking, setAiThinking] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  // Игрок всегда ходит за сторону 0.
  const HUMAN = 0;

  const restart = useCallback(() => {
    setState(createGame(gameData, setup.decks, setup.seed + Math.floor(Math.random() * 100000)));
    setAiNotice(null);
  }, [setup.decks, setup.seed]);

  const perform = useCallback((action: Action) => {
    setState((prev) => (prev.current === HUMAN ? reduce(prev, action, gameData) : prev));
  }, []);

  useEffect(() => {
    // Ход вернулся к игроку — снимаем индикатор раздумий в любом случае.
    // Полагаться на завершение асинхронного цикла нельзя: его прерывает очистка эффекта.
    if (state.winner !== null || state.current === HUMAN) {
      setAiThinking(false);
      return;
    }

    let cancelled = false;
    const agent = createAgent(setup.mode);

    async function playAiTurn() {
      setAiThinking(true);
      let current = state;

      for (let i = 0; i < AI_MAX_ACTIONS_PER_TURN; i++) {
        if (cancelled || current.winner !== null || current.current === HUMAN) break;

        let action: Action | null = null;
        if (setup.mode === 'llm') {
          action = await requestServerMove(current);
          if (!action) {
            setAiNotice('Нейросеть недоступна — ход делает программный ИИ «Офицер».');
            action = await createAgent('officer').chooseAction(current, gameData);
          }
        } else {
          action = await agent.chooseAction(current, gameData);
        }

        const before = current;
        current = reduce(current, action, gameData);
        // Если ход ничего не изменил, принудительно передаём ход: иначе цикл встанет.
        if (current === before) current = reduce(current, { type: 'endTurn' }, gameData);

        if (cancelled) break;
        setState(current);
        await new Promise((r) => setTimeout(r, AI_MOVE_DELAY_MS));
      }

      if (!cancelled) setAiThinking(false);
    }

    void playAiTurn();
    return () => {
      cancelled = true;
    };
    // Реагируем на смену активной стороны, а не на каждое изменение состояния.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.current, state.winner, setup.mode]);

  const legalActions = state.current === HUMAN && state.winner === null
    ? getLegalActions(state, resolver.current)
    : [];

  return { state, legalActions, aiThinking, aiNotice, perform, restart };
}
