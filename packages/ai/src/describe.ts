// Текстовое описание позиции и ходов для оппонента на нейросети.
//
// Модель не видит интерфейс, поэтому позиция передаётся словами. Описание
// намеренно компактное: длинный текст удорожает запрос и размывает выбор.

import type { Action, GameState } from '@wotg/engine';
import { HQ_POSITIONS, opponentOf } from '@wotg/engine';
import type { GameData } from '@wotg/shared';

const CLASS_RU: Record<string, string> = {
  light: 'ЛТ',
  medium: 'СТ',
  heavy: 'ТТ',
  td: 'ПТ-САУ',
  spg: 'САУ',
};

function cell(pos: { row: number; col: number }): string {
  // Клетки нумеруются как в шахматах: буква — столбец, цифра — строка.
  return `${'ABCDE'[pos.col]}${pos.row + 1}`;
}

export function describeState(state: GameState, data: GameData): string {
  const me = state.current;
  const foe = opponentOf(me);
  const mine = state.players[me];
  const theirs = state.players[foe];

  const lines: string[] = [];
  lines.push(`Ход ${state.turn}. Ты играешь за игрока ${me + 1}.`);
  lines.push(
    `Твой штаб ${mine.hq.cardName} (${cell(HQ_POSITIONS[me])}): прочность ${mine.hq.hp}/${mine.hq.maxHp}, ` +
      `атака ${mine.hq.attack}, прирост ${mine.hq.income}. Ресурсов сейчас: ${mine.resources}.`,
  );
  lines.push(
    `Штаб противника ${theirs.hq.cardName} (${cell(HQ_POSITIONS[foe])}): прочность ${theirs.hq.hp}/${theirs.hq.maxHp}, ` +
      `атака ${theirs.hq.attack}.`,
  );

  const describeUnit = (u: (typeof state.units)[number]) =>
    `${u.cardName} [${CLASS_RU[u.vehicleClass] ?? u.vehicleClass}] ${cell(u.pos)} ` +
    `${u.hp}/${u.maxHp} ХП, атака ${u.attack}` +
    (u.keywords.length ? `, свойства: ${u.keywords.join(', ')}` : '') +
    (u.attacksUsed > 0 ? ', уже атаковал' : '');

  const myUnits = state.units.filter((u) => u.owner === me);
  const foeUnits = state.units.filter((u) => u.owner === foe);

  lines.push(`Твоя техника (${myUnits.length}): ${myUnits.map(describeUnit).join('; ') || 'нет'}`);
  lines.push(`Техника противника (${foeUnits.length}): ${foeUnits.map(describeUnit).join('; ') || 'нет'}`);

  if (mine.squads.length) {
    lines.push(
      `Твои взводы: ${mine.squads
        .map((s) => `${s.cardName} (${s.bonus === 'attack' ? 'атакующий' : 'защитный'}, поддержка ${s.support}, ${s.hp} ХП)`)
        .join('; ')}`,
    );
  }
  if (theirs.squads.length) {
    lines.push(
      `Взводы противника: ${theirs.squads
        .map((s) => `${s.cardName} (${s.bonus === 'attack' ? 'атакующий' : 'защитный'}, поддержка ${s.support})`)
        .join('; ')}`,
    );
  }

  const hand = mine.hand.map((name) => {
    const c = data.byName.get(name);
    if (!c) return name;
    const stat = c.kind === 'order' ? 'приказ' : `${c.attack ?? 0}/${c.hp ?? 0}`;
    return `${name} (${c.kindRu}, цена ${c.cost ?? 0}, ${stat})`;
  });
  lines.push(`Твоя рука: ${hand.join('; ') || 'пусто'}`);
  lines.push(`Карт в колоде: ${mine.deck.length}, в потерях: ${mine.casualties.length}.`);

  return lines.join('\n');
}

export function describeAction(state: GameState, action: Action, data: GameData): string {
  const unitName = (uid: string) => state.units.find((u) => u.uid === uid)?.cardName ?? uid;
  const unitCell = (uid: string) => {
    const u = state.units.find((x) => x.uid === uid);
    return u ? cell(u.pos) : '?';
  };

  switch (action.type) {
    case 'deploy': {
      const name = state.players[state.current].hand[action.cardIndex] ?? '?';
      const card = data.byName.get(name);
      return `Вывести ${name} (цена ${card?.cost ?? '?'}) на ${cell(action.pos)}`;
    }
    case 'deploySquad': {
      const name = state.players[state.current].hand[action.cardIndex] ?? '?';
      return `Разыграть взвод ${name}`;
    }
    case 'playOrder': {
      const name = state.players[state.current].hand[action.cardIndex] ?? '?';
      return `Разыграть приказ ${name}`;
    }
    case 'move':
      return `Переместить ${unitName(action.uid)} с ${unitCell(action.uid)} на ${cell(action.to)}`;
    case 'attack': {
      const who =
        action.attacker.kind === 'hq'
          ? 'штабом'
          : `${unitName(action.attacker.uid)} (${unitCell(action.attacker.uid)})`;
      const whom =
        action.target.kind === 'hq'
          ? 'штаб противника'
          : `${unitName(action.target.uid)} (${unitCell(action.target.uid)})`;
      return `Атаковать ${whom} — ${who}`;
    }
    case 'endTurn':
      return 'Завершить ход';
  }
}
