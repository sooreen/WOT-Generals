// Доменные типы World of Tanks Generals.
// Названия и значения соответствуют официальному руководству игры;
// расшифровка терминов — в docs/05-глоссарий.md.

export type Nation = 'ussr' | 'germany' | 'usa';

export type CardKind = 'vehicle' | 'hq' | 'platoon' | 'order';

/** Класс техники определяет правила перемещения, атаки и контратаки. */
export type VehicleClass = 'light' | 'medium' | 'heavy' | 'td' | 'spg';

/** Тип штаба влияет на его характеристики и на зависимые свойства карт. */
export type HQType = 'training' | 'strike' | 'combined' | 'rear';

/** Специализация взвода. Одновременно поддерживать штаб может по одному взводу каждой. */
export type PlatoonSpec = 'recon' | 'signals' | 'artillery' | 'medics' | 'engineers';

/** Взвод либо усиливает атаку штаба, либо поглощает урон по нему. */
export type PlatoonBonus = 'attack' | 'defence';

export type Rarity =
  | 'normal'
  | 'premium'
  | 'starter'
  | 'training'
  | 'gift'
  | 'mercenary'
  | 'removed';

/**
 * Ключевые свойства карт. Семь первых — из официального раздела «Свойства карт»,
 * `immobile` добавлен для учебной техники, которая не может перемещаться.
 */
export type Keyword =
  | 'rearguard'       // Арьергард: розыгрыш за 0, если карта последняя в руке
  | 'blitz'           // Блиц: оплата случайными картами из колоды вместо ресурсов
  | 'massProduction'  // Конвейер: копий в колоде = уровень штаба + 3
  | 'camouflage'      // Маскировка: не может быть атакована штабом и САУ
  | 'guard'           // Охранение: принимает урон по штабу, находясь на плацдарме
  | 'cover'           // Прикрытие: не получает контратак
  | 'reinforcements'  // Подкрепления: при розыгрыше — дополнительная карта в руку
  | 'immobile';       // не может перемещаться

/** Условие, при котором работает зависимое свойство карты. */
export interface AbilityCondition {
  hqNation?: Nation;
  hqType?: HQType;
}

export interface AbilityClause {
  op: string;
  [key: string]: unknown;
}

export interface Ability {
  raw: string;
  condition: AbilityCondition | null;
  clauses: AbilityClause[];
  /** full — движок исполняет; partial — частично; none — только текст; note — пояснение. */
  coverage: 'full' | 'partial' | 'none' | 'note';
}

/** Карта как она описана в базе данных (неизменяемое определение). */
export interface CardDef {
  id: string;
  name: string;
  title: string;
  kind: CardKind;
  kindRu: string;
  nation: Nation | null;
  nationRu: string | null;
  tier: number | null;
  cost: number | null;
  attack: number | null;
  hp: number | null;
  income: number | null;
  attackBoosted: number | null;
  hpBoosted: number | null;
  incomeBoosted: number | null;
  conveyor: boolean;
  rarity: Rarity;
  rarityRu: string;
  vehicleClass: VehicleClass | null;
  vehicleClassRu: string | null;
  hqType: HQType | null;
  hqTypeRu: string | null;
  platoonBonus: PlatoonBonus | null;
  platoonSpec: PlatoonSpec | null;
  platoonSpecRu: string | null;
  branch: string | null;
  prev: string[];
  next: string[];
  xp: number | null;
  credits: number | null;
  description: string | null;
  abilities: string[];
  aliases: string[];
  oldNames: string[];
  nicknames: string[];
  imageCode: string | null;
  imageFile: string | null;
  sourceUrl: string;
}

/** Колода: штаб плюс ровно 40 карт. */
export interface Deck {
  id: string;
  name: string;
  hq: string;
  cards: string[];
}

export const BOARD_ROWS = 3;
export const BOARD_COLS = 5;

/** Размер руки, стартовая рука и размер колоды — из официальных правил боя. */
export const HAND_LIMIT = 6;
export const STARTING_HAND = 6;
export const DECK_SIZE = 40;
export const MAX_COPIES = 3;

export interface Position {
  row: number;
  col: number;
}
