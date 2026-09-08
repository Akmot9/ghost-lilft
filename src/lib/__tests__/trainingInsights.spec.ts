import { describe, it, expect } from 'vitest'
import { compareSetToGhost, getDateKey } from '../trainingInsights'

// Ce qui reste des règles côté Vue (#71) : la clé de journée du contrat, et le
// verdict d'une série face à son fantôme — la seule lecture calculée à
// l'écran, dont `compare_to_ghost` (Rust) est la référence, verrouillée par la
// fixture partagée.

describe('getDateKey', () => {
  it('lit la journée UTC de la série, comme le contrat la définit', () => {
    expect(getDateKey(new Date('2026-04-27T23:30:00.000Z'))).toBe('2026-04-27')
  })
})

describe('compareSetToGhost', () => {
  it('reconnaît une charge battue', () => {
    expect(compareSetToGhost({ reps: 8, weight: 68 }, { reps: 8, weight: 66 })).toEqual({
      weightDelta: 2,
      repsDelta: 0,
      outcome: 'progress',
    })
  })

  it('reconnaît des répétitions gagnées à charge égale', () => {
    expect(compareSetToGhost({ reps: 9, weight: 70 }, { reps: 8, weight: 70 })).toEqual({
      weightDelta: 0,
      repsDelta: 1,
      outcome: 'progress',
    })
  })

  it('reconnaît une série identique', () => {
    expect(compareSetToGhost({ reps: 8, weight: 70 }, { reps: 8, weight: 70 })).toEqual({
      weightDelta: 0,
      repsDelta: 0,
      outcome: 'equal',
    })
  })

  it('reconnaît un recul', () => {
    expect(compareSetToGhost({ reps: 6, weight: 70 }, { reps: 8, weight: 70 })).toEqual({
      weightDelta: 0,
      repsDelta: -2,
      outcome: 'regress',
    })
  })

  it('tranche par la charge quand elle monte et que les répétitions baissent', () => {
    // Cas courant en pyramidal : on charge plus lourd pour moins de reps.
    // Le verdict suit la charge, mais les deux écarts restent lisibles pour
    // que le lifteur juge lui-même.
    expect(compareSetToGhost({ reps: 6, weight: 76 }, { reps: 8, weight: 70 })).toEqual({
      weightDelta: 6,
      repsDelta: -2,
      outcome: 'progress',
    })
  })

  it('tranche par la charge quand elle baisse et que les répétitions montent', () => {
    expect(compareSetToGhost({ reps: 10, weight: 60 }, { reps: 8, weight: 70 })).toEqual({
      weightDelta: -10,
      repsDelta: 2,
      outcome: 'regress',
    })
  })
})
