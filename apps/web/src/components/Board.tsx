// Игровое поле 3×5 со штабами в противоположных углах.

import type { Action, GameState, UnitState } from '@wotg/engine';
import type { Position } from '@wotg/shared';
import { HQ_POSITIONS, samePos } from '@wotg/engine';
import { BOARD_COLS, BOARD_ROWS } from '@wotg/shared';
import { gameData, cardArtUrl } from '../data.js';

const CLASS_LABEL: Record<string, string> = {
  light: 'ЛТ', medium: 'СТ', heavy: 'ТТ', td: 'ПТ', spg: 'САУ',
};

interface Props {
  state: GameState;
  legalActions: Action[];
  selectedUid: string | null;
  pendingDeploy: number | null;
  onSelectUnit(uid: string): void;
  onCellClick(pos: Position): void;
  onAttackHq(): void;
}

export function Board({
  state, legalActions, selectedUid, pendingDeploy, onSelectUnit, onCellClick, onAttackHq,
}: Props) {
  const unitAt = (pos: Position): UnitState | undefined =>
    state.units.find((u) => samePos(u.pos, pos));

  // Подсветка: куда можно вывести карту, куда пойти и кого атаковать.
  const deployCells = new Set(
    legalActions
      .filter((a) => a.type === 'deploy' && (pendingDeploy === null || a.cardIndex === pendingDeploy))
      .map((a) => (a.type === 'deploy' ? `${a.pos.row},${a.pos.col}` : '')),
  );
  const moveCells = new Set(
    legalActions
      .filter((a) => a.type === 'move' && a.uid === selectedUid)
      .map((a) => (a.type === 'move' ? `${a.to.row},${a.to.col}` : '')),
  );
  const attackableUids = new Set(
    legalActions
      .filter((a) => a.type === 'attack' && a.target.kind === 'unit')
      .filter((a) => a.type === 'attack' && (a.attacker.kind === 'hq' || a.attacker.uid === selectedUid))
      .map((a) => (a.type === 'attack' && a.target.kind === 'unit' ? a.target.uid : '')),
  );
  const canHitEnemyHq = legalActions.some(
    (a) => a.type === 'attack' && a.target.kind === 'hq' && a.target.player === 1,
  );

  const cells = [];
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const pos = { row, col };
      const key = `${row},${col}`;
      const isOwnHq = samePos(pos, HQ_POSITIONS[0]);
      const isFoeHq = samePos(pos, HQ_POSITIONS[1]);
      const unit = unitAt(pos);

      if (isOwnHq || isFoeHq) {
        const side = isOwnHq ? 0 : 1;
        const hq = state.players[side].hq;
        cells.push(
          <div
            key={key}
            className={`cell hq ${isOwnHq ? 'own' : 'foe'} ${isFoeHq && canHitEnemyHq ? 'targetable' : ''}`}
            onClick={isFoeHq && canHitEnemyHq ? onAttackHq : undefined}
            title={`${hq.cardName} — штаб`}
          >
            <div className="hq-name">{hq.cardName}</div>
            <div className="hq-stats">
              <span className="stat attack">{hq.attack}</span>
              <span className="stat hp">{hq.hp}</span>
              <span className="stat income">+{hq.income}</span>
            </div>
            <div className="hpbar">
              <div className="hpbar-fill" style={{ width: `${(hq.hp / hq.maxHp) * 100}%` }} />
            </div>
          </div>,
        );
        continue;
      }

      const classes = ['cell'];
      if (deployCells.has(key)) classes.push('deployable');
      if (moveCells.has(key)) classes.push('movable');
      if (unit && attackableUids.has(unit.uid)) classes.push('targetable');
      if (unit && unit.uid === selectedUid) classes.push('selected');

      cells.push(
        <div
          key={key}
          className={classes.join(' ')}
          onClick={() => (unit ? onSelectUnit(unit.uid) : onCellClick(pos))}
        >
          {unit ? <UnitChip unit={unit} /> : <span className="coord">{'ABCDE'[col]}{row + 1}</span>}
        </div>,
      );
    }
  }

  return <div className="board">{cells}</div>;
}

function UnitChip({ unit }: { unit: UnitState }) {
  const card = gameData.byName.get(unit.cardName);
  const art = cardArtUrl(card);
  return (
    <div className={`unit ${unit.owner === 0 ? 'mine' : 'theirs'}`}>
      {art && <img className="unit-art" src={art} alt="" loading="lazy" />}
      <div className="unit-overlay">
        <span className="unit-class">{CLASS_LABEL[unit.vehicleClass]}</span>
        <span className="unit-name">{unit.cardName}</span>
        <span className="unit-stats">
          <b className="attack">{unit.attack}</b>
          <b className="hp">{unit.hp}</b>
        </span>
      </div>
      {unit.keywords.length > 0 && (
        <div className="unit-keywords" title={unit.keywords.join(', ')}>
          {unit.keywords.length}
        </div>
      )}
    </div>
  );
}
