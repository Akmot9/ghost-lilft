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

  it('exclut les séries d’échauffement du volume hebdomadaire', () => {
    const warmup = set(3, '2026-08-10T17:50:00.000Z', 10, 100)
    warmup.isWarmup = true
    const wrapper = mountGraph([
      set(1, '2026-08-03T18:00:00.000Z', 10, 50),
      set(2, '2026-08-10T18:00:00.000Z', 10, 60),
      warmup,
    ])

    expect(wrapper.findAll('.latest-values strong').map((value) => value.text())).toEqual([
      '500 kg',
      '600 kg',
    ])
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

  it('espace les étiquettes de dates quel que soit l’historique', () => {
    // Un pas d'étiquetage fixe tenait jusqu'à une douzaine de semaines, puis
    // les dates se rechevauchaient : trois ans d'historique en affichait une
    // trentaine dans la même largeur. Le nombre d'étiquettes doit rester
    // borné, pas la seule densité.
    const troisAns = Array.from({ length: 59 }, (_, index) =>
      set(index + 1, `${new Date(Date.UTC(2023, 0, 2 + index * 7)).toISOString()}`, 10, 50 + index),
    )

    const wrapper = mountGraph(troisAns)

    expect(wrapper.findAll('.candle-body')).toHaveLength(59)
    // Ces étiquettes portent l'année, donc sont larges : il en tient quatre.
    expect(wrapper.findAll('.week-label').length).toBeLessThanOrEqual(4)
  })

  it('date les étiquettes par leur année dès que l’historique en traverse plusieurs', () => {
    // « 24 oct. » et « 10 mars » ne se situent pas l'un par rapport à l'autre
    // quand trois ans les séparent.
    const deuxAnnees = [
      set(1, '2023-11-06T18:00:00.000Z', 10, 50),
      set(2, '2023-11-13T18:00:00.000Z', 10, 55),
      set(3, '2024-03-04T18:00:00.000Z', 10, 60),
    ]

    const wrapper = mountGraph(deuxAnnees)

    expect(wrapper.findAll('.week-label').at(0)!.text()).toMatch(/23$/)
    expect(wrapper.findAll('.week-label').at(-1)!.text()).toMatch(/24$/)
  })

  it('rentre les étiquettes de bord dans le cadre', () => {
    // Centrée sur sa bougie, la première étiquette déborde à gauche du SVG et
    // s'y fait rogner — « 24 oct. 22 » s'affichait « 4 oct. 22 ».
    const wrapper = mountGraph(
      Array.from({ length: 20 }, (_, index) =>
        set(index + 1, new Date(Date.UTC(2023, 0, 2 + index * 7)).toISOString(), 10, 50 + index),
      ),
    )

    const labels = wrapper.findAll('.week-label')

    expect(labels.at(0)!.classes()).toContain('week-label--start')
    expect(labels.at(-1)!.classes()).toContain('week-label--end')
  })

  it('tait l’année tant que l’historique tient dans une seule', () => {
    const wrapper = mountGraph([
      set(1, '2026-07-20T18:00:00.000Z', 10, 50),
      set(2, '2026-07-27T18:00:00.000Z', 10, 55),
      set(3, '2026-08-03T18:00:00.000Z', 10, 60),
    ])

    for (const label of wrapper.findAll('.week-label')) {
      expect(label.text()).not.toMatch(/\d{2}$/)
    }
  })

  it('étiquette chaque semaine tant qu’elles sont peu nombreuses', () => {
    const wrapper = mountGraph([
      set(1, '2026-07-20T18:00:00.000Z', 10, 50),
      set(2, '2026-07-27T18:00:00.000Z', 10, 55),
      set(3, '2026-08-03T18:00:00.000Z', 10, 60),
    ])

    expect(wrapper.findAll('.week-label')).toHaveLength(3)
  })
})
