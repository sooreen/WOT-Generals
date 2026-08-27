// Загрузка игровых данных с диска. Точка входа только для Node
// (сервер, скрипты, тесты). Клиент импортирует JSON напрямую через сборщик.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameData, type AbilitiesFile, type GameData } from './data.js';
import type { CardDef } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(here, '../../../data');

let cache: GameData | null = null;

export function loadGameData(): GameData {
  if (cache) return cache;
  const read = <T>(name: string): T =>
    JSON.parse(readFileSync(resolve(DATA_DIR, name), 'utf8')) as T;

  cache = createGameData(read<CardDef[]>('cards.json'), read<AbilitiesFile>('abilities.json'));
  return cache;
}
