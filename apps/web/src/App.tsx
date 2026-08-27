import { useState } from 'react';
import type { DeckSpec } from '@wotg/engine';
import type { OpponentMode } from '@wotg/ai';
import { Menu } from './components/Menu.js';
import { Battle } from './components/Battle.js';
import { useBattle, type BattleSetup } from './useBattle.js';

export function App() {
  const [setup, setSetup] = useState<BattleSetup | null>(null);

  if (!setup) return <Menu onStart={(s: { decks: [DeckSpec, DeckSpec]; mode: OpponentMode; seed: number }) => setSetup(s)} />;
  return <BattleScreen setup={setup} onExit={() => setSetup(null)} />;
}

/** Отдельный компонент: хук боя должен пересоздаваться при новом наборе настроек. */
function BattleScreen({ setup, onExit }: { setup: BattleSetup; onExit(): void }) {
  const battle = useBattle(setup);
  return <Battle battle={battle} onExit={onExit} />;
}
