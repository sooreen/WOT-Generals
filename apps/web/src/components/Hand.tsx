// Рука игрока: карты, которые можно разыграть в этот ход.

import type { Action, GameState } from '@wotg/engine';
import { gameData, cardArtUrl } from '../data.js';

interface Props {
  state: GameState;
  legalActions: Action[];
  pendingDeploy: number | null;
  onPick(index: number): void;
}

export function Hand({ state, legalActions, pendingDeploy, onPick }: Props) {
  const hand = state.players[0].hand;

  // Карта играбельна, если для неё есть хотя бы один легальный ход.
  const playable = new Set(
    legalActions
      .filter((a) => a.type === 'deploy' || a.type === 'deploySquad' || a.type === 'playOrder')
      .map((a) => ('cardIndex' in a ? a.cardIndex : -1)),
  );

  return (
    <div className="hand">
      {hand.map((name, index) => {
        const card = gameData.byName.get(name);
        const art = cardArtUrl(card);
        const isPlayable = playable.has(index);
        return (
          <button
            key={`${name}-${index}`}
            type="button"
            className={`card ${isPlayable ? 'playable' : 'blocked'} ${pendingDeploy === index ? 'picked' : ''}`}
            onClick={() => isPlayable && onPick(index)}
            disabled={!isPlayable}
            title={card?.description ?? name}
          >
            {art ? <img src={art} alt={name} loading="lazy" /> : <span className="card-fallback">{name}</span>}
            <span className="card-cost">{card?.cost ?? 0}</span>
            <span className="card-caption">{name}</span>
          </button>
        );
      })}
      {hand.length === 0 && <p className="empty">Рука пуста</p>}
    </div>
  );
}
