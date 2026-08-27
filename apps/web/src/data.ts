// Игровые данные для браузера: JSON включается в сборку напрямую,
// без обращения к файловой системе.

import { createGameData, type AbilitiesFile, type CardDef, type GameData } from '@wotg/shared';
import cardsJson from '@data/cards.json';
import abilitiesJson from '@data/abilities.json';

export const gameData: GameData = createGameData(
  cardsJson as unknown as CardDef[],
  abilitiesJson as unknown as AbilitiesFile,
);

/**
 * Путь к арту карты. Сервер отдаёт data/assets под префиксом /art/
 * (не /assets/ — этот путь занят бандлами клиента).
 */
export function cardArtUrl(card: CardDef | undefined): string | null {
  if (!card?.imageFile) return null;
  return `/art/cards/${card.imageFile}`;
}
