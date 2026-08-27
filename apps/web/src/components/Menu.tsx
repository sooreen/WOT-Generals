// Главное меню: выбор штаба, соперника и уровня сложности.

import { useEffect, useMemo, useState } from 'react';
import { buildDeckForHQ, validateDeck, type DeckSpec } from '@wotg/engine';
import { DIFFICULTY_DESCRIPTION, DIFFICULTY_RU, type OpponentMode } from '@wotg/ai';
import { gameData, cardArtUrl } from '../data.js';

const NATION_RU: Record<string, string> = { ussr: 'СССР', germany: 'Германия', usa: 'США' };

interface Props {
  onStart(setup: { decks: [DeckSpec, DeckSpec]; mode: OpponentMode; seed: number }): void;
}

export function Menu({ onStart }: Props) {
  const hqs = useMemo(
    () => gameData.cards.filter((c) => c.kind === 'hq' && c.rarity !== 'removed'),
    [],
  );

  const [myHq, setMyHq] = useState(() => hqs.find((c) => c.nation === 'ussr')?.name ?? hqs[0]!.name);
  const [foeHq, setFoeHq] = useState(() => hqs.find((c) => c.nation === 'germany')?.name ?? hqs[0]!.name);
  const [mode, setMode] = useState<OpponentMode>('sergeant');
  const [llmAvailable, setLlmAvailable] = useState(false);

  // Режим нейросети показываем только если сервер сообщил, что ключ настроен.
  useEffect(() => {
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => setLlmAvailable(Boolean(cfg?.llmAvailable)))
      .catch(() => setLlmAvailable(false));
  }, []);

  const myDeck = useMemo(() => buildDeckForHQ(gameData, myHq), [myHq]);
  const foeDeck = useMemo(() => buildDeckForHQ(gameData, foeHq), [foeHq]);
  const check = useMemo(() => validateDeck(gameData, myDeck), [myDeck]);

  return (
    <div className="menu">
      <header className="menu-head">
        <h1>World of Tanks Generals</h1>
        <p className="subtitle">Реконструкция карточной игры Wargaming (2015–2016)</p>
      </header>

      <section className="menu-block">
        <h2>Ваш штаб</h2>
        <HqPicker value={myHq} onChange={setMyHq} options={hqs} />
      </section>

      <section className="menu-block">
        <h2>Штаб противника</h2>
        <HqPicker value={foeHq} onChange={setFoeHq} options={hqs} />
      </section>

      <section className="menu-block">
        <h2>Соперник</h2>
        <div className="difficulties">
          {(['recruit', 'sergeant', 'officer', 'general'] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={`difficulty ${mode === d ? 'active' : ''}`}
              onClick={() => setMode(d)}
            >
              <span className="difficulty-name">{DIFFICULTY_RU[d]}</span>
              <span className="difficulty-desc">{DIFFICULTY_DESCRIPTION[d]}</span>
            </button>
          ))}
          <button
            type="button"
            className={`difficulty llm ${mode === 'llm' ? 'active' : ''} ${llmAvailable ? '' : 'unavailable'}`}
            onClick={() => llmAvailable && setMode('llm')}
            disabled={!llmAvailable}
          >
            <span className="difficulty-name">Нейросеть</span>
            <span className="difficulty-desc">
              {llmAvailable
                ? 'Ходы выбирает языковая модель через API. Ход всегда проверяется движком.'
                : 'Недоступно: на сервере не задан ANTHROPIC_API_KEY.'}
            </span>
          </button>
        </div>
      </section>

      <section className="menu-block">
        <h2>Колода</h2>
        <p className="deck-summary">
          Автоматически собрана из карт нации: {myDeck.cards.length} карт,
          балансный вес {check.balanceWeight}.
          {check.valid ? ' Состав соответствует правилам.' : ' Внимание: ' + check.errors.join('; ')}
        </p>
      </section>

      <button
        type="button"
        className="primary start"
        onClick={() =>
          onStart({
            decks: [myDeck, foeDeck],
            mode,
            seed: Math.floor(Math.random() * 1_000_000),
          })
        }
      >
        В бой
      </button>
    </div>
  );
}

function HqPicker({
  value, onChange, options,
}: {
  value: string;
  onChange(name: string): void;
  options: typeof gameData.cards;
}) {
  return (
    <div className="hq-picker">
      {options.map((hq) => {
        const art = cardArtUrl(hq);
        return (
          <button
            key={hq.name}
            type="button"
            className={`hq-option ${value === hq.name ? 'active' : ''}`}
            onClick={() => onChange(hq.name)}
            title={hq.description ?? hq.name}
          >
            {art && <img src={art} alt="" loading="lazy" />}
            <span className="hq-option-name">{hq.name}</span>
            <span className="hq-option-meta">
              {NATION_RU[hq.nation ?? ''] ?? '—'} · {hq.hqTypeRu ?? '—'} · ур. {hq.tier ?? '?'}
            </span>
            <span className="hq-option-stats">
              ⚔ {hq.attack ?? 0} · ❤ {hq.hp ?? 0} · ⛽ {hq.income ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
