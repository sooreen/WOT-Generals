// Зона поддержки штаба: до пяти взводов, по одному каждой специализации.

import type { SquadState } from '@wotg/engine';

const SPEC_RU: Record<string, string> = {
  recon: 'Разведчики',
  signals: 'Связисты',
  artillery: 'Артиллеристы',
  medics: 'Медики',
  engineers: 'Инженеры',
};

const SPEC_ORDER = ['recon', 'signals', 'artillery', 'medics', 'engineers'] as const;

export function SquadZone({ squads, title }: { squads: SquadState[]; title: string }) {
  return (
    <div className="squads">
      <h3>{title}</h3>
      <div className="squad-slots">
        {SPEC_ORDER.map((spec) => {
          const squad = squads.find((s) => s.spec === spec);
          return (
            <div key={spec} className={`squad-slot ${squad ? squad.bonus : 'empty'}`} title={SPEC_RU[spec]}>
              {squad ? (
                <>
                  <span className="squad-name">{squad.cardName}</span>
                  <span className="squad-stats">
                    {squad.bonus === 'attack' ? '⚔' : '🛡'} {squad.support} · {squad.hp} ХП
                  </span>
                </>
              ) : (
                <span className="squad-empty">{SPEC_RU[spec]}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
