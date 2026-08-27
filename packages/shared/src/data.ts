// Сборка и загрузка игровых данных.
//
// Данные нужны и на сервере, и в браузере, поэтому разделены две вещи:
//   createGameData — чистая сборка индексов из уже полученного JSON (работает везде);
//   loadGameData   — чтение файлов с диска, вынесено в точку входа @wotg/shared/node.
// Разделение нужно для клиента: любой импорт node:fs в общем модуле ломает сборку браузера.

import type { Ability, CardDef, Keyword } from './types.js';

export interface GameData {
  cards: CardDef[];
  byName: Map<string, CardDef>;
  abilities: Record<string, Ability[]>;
  /** Ключевые свойства карты вместе с условием, при котором они действуют. */
  keywords: Record<string, Array<{ keyword: Keyword; condition: Ability['condition'] }>>;
}

export interface AbilitiesFile {
  abilities: Record<string, Ability[]>;
  keywordIndex: Record<string, Array<{ keyword: Keyword; condition: Ability['condition'] }>>;
}

/** Собирает индексы поверх сырых JSON — работает и в браузере, и в Node. */
export function createGameData(cards: CardDef[], abilitiesFile: AbilitiesFile): GameData {
  return {
    cards,
    byName: new Map(cards.map((c) => [c.name, c])),
    abilities: abilitiesFile.abilities,
    keywords: abilitiesFile.keywordIndex,
  };
}

/** Карта по имени или по одному из её альтернативных названий. */
export function findCard(data: GameData, name: string): CardDef | undefined {
  const direct = data.byName.get(name);
  if (direct) return direct;
  return data.cards.find((c) => c.aliases.includes(name) || c.oldNames.includes(name));
}
