// Лог боя: без него непонятно, что именно сделал противник.

import { useEffect, useRef } from 'react';
import type { LogEntry } from '@wotg/engine';

export function BattleLog({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log.length]);

  return (
    <div className="log" ref={ref}>
      {log.slice(-60).map((entry, i) => (
        <div key={i} className={`log-line p${entry.player}`}>
          <span className="log-turn">{entry.turn}</span> {entry.text}
        </div>
      ))}
    </div>
  );
}
