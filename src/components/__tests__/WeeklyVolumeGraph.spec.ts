import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WeeklyVolumeGraph from '../WeeklyVolumeGraph.vue'
import type { ExerciseSet } from '../../lib/trainingInsights'

function set(id: number, date: string, reps: number, weight: number): ExerciseSet {
  return { id, reps, weight, completedAt: new Date(date) }
}

function mountGraph(sets: ExerciseSet[]) {
  return mount(WeeklyVolumeGraph, { props: { sets, weightUnit: 'kg' } })
}

describe('WeeklyVolumeGraph', () => {
  it('ne montre aucun graphe tant qu’aucune série n’est enregistrée', () => {
    const wrapper = mountGraph([])

    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.text()).toContain('Ajoute des séries')
  })

  it('annonce l’attente plutôt que de tracer une tendance sur une seule semaine', () => {
    // L'échelle est ancrée à zéro : une valeur unique vaut 100 % de la hauteur
    // et se dessine tout en haut du cadre, le reste restant vide. Le résultat
    // ressemble à une panne — c'est l'état de tout nouvel utilisateur, et donc
    // celui que voit un reviewer App Store.
    const wrapper = mountGraph([
      set(1, '2026-08-10T18:00:00.000Z', 8, 60),
      set(2, '2026-08-11T18:00:00.000Z', 8, 60),
    ])

    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.text()).toContain('deuxième semaine')
  })

  it('trace la tendance dès la deuxième semaine', () => {
    const wrapper = mountGraph([
      set(1, '2026-08-03T18:00:00.000Z', 10, 50),
      set(2, '2026-08-10T18:00:00.000Z', 10, 60),
    ])

    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.findAll('.candle-body')).toHaveLength(2)
  })

  it('étale la tendance sur la hauteur au lieu de l’écraser', () => {
    // Volumes proches de la réalité : une progression de 31 %, qui sur une
    // échelle ancrée à zéro n'occupait qu'un quart du cadre et se lisait comme
    // une ligne plate.
    const wrapper = mountGraph([
      set(1, '2026-07-20T18:00:00.000Z', 10, 567),
      set(2, '2026-07-27T18:00:00.000Z', 10, 620),
      set(3, '2026-08-03T18:00:00.000Z', 10, 690),
      set(4, '2026-08-10T18:00:00.000Z', 10, 743),
    ])

    const bodies = wrapper.findAll('.candle-body')
    const hauts = bodies.map((body) => Number(body.attributes('y')))
    const bas = bodies.map(
      (body) => Number(body.attributes('y')) + Number(body.attributes('height')),
    )

    const couvert = Math.max(...bas) - Math.min(...hauts)
    const hauteurUtile = 220 - 14 - 34

    expect(bodies).toHaveLength(4)
    expect(couvert).toBeGreaterThan(hauteurUtile * 0.6)
  })

  it('colle les bougies les unes aux autres', () => {
    const wrapper = mountGraph([
      set(1, '2026-07-20T18:00:00.000Z', 10, 50),
      set(2, '2026-07-27T18:00:00.000Z', 10, 60),
      set(3, '2026-08-03T18:00:00.000Z', 10, 55),
    ])

    const bodies = wrapper.findAll('.candle-body')
    const gauches = bodies.map((body) => Number(body.attributes('x')))
    const largeur = Number(bodies[0]?.attributes('width'))

    // Le pas entre deux bougies ne dépasse la largeur du corps que de l'écart
    // voulu : elles se touchent presque, comme sur un graphe boursier.
    const pas = (gauches[1] as number) - (gauches[0] as number)
    expect(pas - largeur).toBeCloseTo(2)
  })

  it('ne dessine une mèche que si la semaine compte plusieurs séances', () => {
    const uneSeance = mountGraph([
      set(1, '2026-07-27T18:00:00.000Z', 10, 50),
      set(2, '2026-08-03T18:00:00.000Z', 10, 60),
    ])
    expect(uneSeance.findAll('.candle-wick')).toHaveLength(0)

    const deuxSeances = mountGraph([
      set(1, '2026-07-27T18:00:00.000Z', 10, 50),
      set(2, '2026-08-03T18:00:00.000Z', 10, 60),
      // Deuxième séance du même exercice dans la même semaine : rare, mais à
      // ne pas faire passer pour une progression.
      set(3, '2026-08-06T18:00:00.000Z', 10, 40),
    ])
    expect(deuxSeances.findAll('.candle-wick')).toHaveLength(1)
  })

  it('reste lisible quand le volume ne bouge pas d’une semaine à l’autre', () => {
    // La stagnation est la raison d'être de l'app : le graphe doit la montrer,
    // pas la faire disparaître.
    const wrapper = mountGraph([
      set(1, '2026-07-27T18:00:00.000Z', 10, 50),
      set(2, '2026-08-03T18:00:00.000Z', 10, 50),
      set(3, '2026-08-10T18:00:00.000Z', 10, 50),
    ])

    const ys = wrapper.findAll('.candle-body').map((body) => Number(body.attributes('y')))

    expect(ys).toHaveLength(3)
    expect(new Set(ys).size).toBe(1)
  })
})
