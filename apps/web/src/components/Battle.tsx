// Экран боя: поле, рука, зоны поддержки, ресурсы и лог.
//
// Взаимодействие построено на двух состояниях выбора:
//   pendingDeploy — выбрана карта в руке, ждём клетку плацдарма;
//   selectedUid   — выбрана своя техника, ждём клетку для хода или цель для атаки.
// Все доступные действия берутся из движка, поэтому подсветка не может разойтись с правилами.

import { useState } from 'react';
import type { Action } from '@wotg/engine';
import type { Position } from '@wotg/shared';
import { samePos } from '@wotg/engine';
import { gameData } from '../data.js';
import type { BattleApi } from '../useBattle.js';
import { Board } from './Board.js';
import { Hand } from './Hand.js';
import { SquadZone } from './SquadZone.js';
import { BattleLog } from './BattleLog.js';

export function Battle({ battle, onExit }: { battle: BattleApi; onExit(): void }) {
  const { state, legalActions, aiThinking, aiNotice, perform, restart } = battle;
  const [pendingDeploy, setPendingDeploy] = useState<number | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const me = state.players[0];
  const foe = state.players[1];
  const myTurn = state.current === 0 && state.winner === null;

  function pickCard(index: number) {
    const name = me.hand[index];
    const card = name ? gameData.byName.get(name) : undefined;

    // Взводы и приказы не требуют выбора клетки — играются сразу.
    if (card?.kind === 'platoon') {
      perform({ type: 'deploySquad', cardIndex: index });
      setPendingDeploy(null);
      return;
    }
    if (card?.kind === 'order') {
      perform({ type: 'playOrder', cardIndex: index });
      setPendingDeploy(null);
      return;
    }
    setPendingDeploy((prev) => (prev === index ? null : index));
    setSelectedUid(null);
  }

  function clickCell(pos: Position) {
    if (pendingDeploy !== null) {
      const action = legalActions.find(
        (a): a is Extract<Action, { type: 'deploy' }> =>
          a.type === 'deploy' && a.cardIndex === pendingDeploy && samePos(a.pos, pos),
      );
      if (action) {
        perform(action);
        setPendingDeploy(null);
      }
      return;
    }
    if (selectedUid) {
      const move = legalActions.find(
        (a): a is Extract<Action, { type: 'move' }> =>
          a.type === 'move' && a.uid === selectedUid && samePos(a.to, pos),
      );
      if (move) perform(move);
    }
  }

  function clickUnit(uid: string) {
    const unit = state.units.find((u) => u.uid === uid);
    if (!unit) return;

    // Клик по чужой технике — попытка атаки выбранной картой или штабом.
    if (unit.owner !== 0) {
      const attack = legalActions.find(
        (a): a is Extract<Action, { type: 'attack' }> =>
          a.type === 'attack' &&
          a.target.kind === 'unit' &&
          a.target.uid === uid &&
          (selectedUid ? a.attacker.kind === 'unit' && a.attacker.uid === selectedUid : a.attacker.kind === 'hq'),
      );
      if (attack) perform(attack);
      return;
    }

    setSelectedUid((prev) => (prev === uid ? null : uid));
    setPendingDeploy(null);
  }

  function attackEnemyHq() {
    const attack = legalActions.find(
      (a): a is Extract<Action, { type: 'attack' }> =>
        a.type === 'attack' &&
        a.target.kind === 'hq' &&
        a.target.player === 1 &&
        (selectedUid ? a.attacker.kind === 'unit' && a.attacker.uid === selectedUid : a.attacker.kind === 'hq'),
    );
    if (attack) perform(attack);
  }

  function endTurn() {
    setPendingDeploy(null);
    setSelectedUid(null);
    perform({ type: 'endTurn' });
  }

  return (
    <div className="battle">
      <header className="battle-top">
        <button type="button" className="ghost" onClick={onExit}>← В меню</button>
        <div className="turn-info">
          <span className="turn-number">Ход {state.turn}</span>
          <span className={`turn-side ${myTurn ? 'mine' : 'theirs'}`}>
            {state.winner !== null ? 'Бой окончен' : myTurn ? 'Ваш ход' : 'Ход противника'}
          </span>
        </div>
        <div className="resources" title="Ресурсы. Неистраченные сгорают в начале следующего хода">
          <span className="res-value">{me.resources}</span> ресурсов
        </div>
      </header>

      {aiNotice && <div className="notice">{aiNotice}</div>}

      <div className="battle-main">
        <aside className="side">
          <SquadZone squads={foe.squads} title="Взводы противника" />
          <div className="deck-info">
            <span>Рука противника: {foe.hand.length}</span>
            <span>Колода: {foe.deck.length}</span>
            <span>Потери: {foe.casualties.length}</span>
          </div>
        </aside>

        <div className="board-area">
          <Board
            state={state}
            legalActions={legalActions}
            selectedUid={selectedUid}
            pendingDeploy={pendingDeploy}
            onSelectUnit={clickUnit}
            onCellClick={clickCell}
            onAttackHq={attackEnemyHq}
          />
          <div className="hint">
            {pendingDeploy !== null
              ? 'Выберите клетку плацдарма для вывода техники'
              : selectedUid
                ? 'Выберите клетку для хода или цель для атаки'
                : 'Выберите карту в руке или свою технику на поле'}
          </div>
        </div>

        <aside className="side">
          <SquadZone squads={me.squads} title="Ваши взводы" />
          <div className="deck-info">
            <span>Колода: {me.deck.length}</span>
            <span>Потери: {me.casualties.length}</span>
          </div>
          <BattleLog log={state.log} />
        </aside>
      </div>

      <footer className="battle-bottom">
        <Hand state={state} legalActions={legalActions} pendingDeploy={pendingDeploy} onPick={pickCard} />
        <button type="button" className="primary end-turn" onClick={endTurn} disabled={!myTurn}>
          {aiThinking ? 'Противник думает…' : 'Завершить ход'}
        </button>
      </footer>

      {state.winner !== null && (
        <div className="overlay">
          <div className="result">
            <h2>{state.winner === 0 ? 'Победа' : 'Поражение'}</h2>
            <p>{state.endReason}</p>
            <div className="result-actions">
              <button type="button" className="primary" onClick={restart}>Ещё бой</button>
              <button type="button" className="ghost" onClick={onExit}>В меню</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
