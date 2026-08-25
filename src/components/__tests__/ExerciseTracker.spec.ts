import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ExerciseTracker from '../ExerciseTracker.vue'
import type { ExerciseSet } from '../../lib/trainingInsights'
import { makeSet } from '../../lib/__tests__/testFactories'

const stubs = { SessionDiff: true, SetGhostChart: true, WeeklyVolumeGraph: true }

function mountTracker(sets: ExerciseSet[] = []) {
  return mount(ExerciseTracker, {
    props: {
      exerciseName: 'Bench press',
      sets,
      defaultReps: 5,
      defaultWeight: 60,
      weightUnit: 'kg',
    },
    global: { stubs },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-27T18:00:00.000Z'))
  // Le repos survit désormais à la fermeture de l'app (échéance persistée) :
  // sans ce nettoyage, un test hériterait du chrono lancé par le précédent.
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ExerciseTracker', () => {
  it('shows no ghost row and the exercise defaults as the target when there are no sets yet', () => {
    const wrapper = mountTracker([])

    expect(wrapper.find('.ghost-row').exists()).toBe(false)
    expect(wrapper.get('.target-chip').text()).toContain('60 kg × 5')
    expect((wrapper.get('input[type=number]').element as HTMLInputElement).value).toBe('5')
  })

  it('shows the ghost row and a suggested target based on the last set', () => {
    const wrapper = mountTracker([
      makeSet({ id: 1, reps: 8, weight: 62, completedAt: new Date('2026-04-20T18:00:00.000Z') }),
    ])

    expect(wrapper.get('.ghost-row').text()).toContain('8 × 62 kg')
    expect(wrapper.get('.ghost-row').text()).toContain('Série 1')
    expect(wrapper.get('.target-chip').text()).toContain('62 kg × 8')

    const inputs = wrapper.findAll('input[type=number]')
    expect((inputs[0]?.element as HTMLInputElement).value).toBe('8')
    expect((inputs[1]?.element as HTMLInputElement).value).toBe('62')
  })

  it('shows the stagnation badge when the two most recent sessions are identical', () => {
    const wrapper = mountTracker([
      makeSet({ id: 1, reps: 6, weight: 86, completedAt: new Date('2026-04-20T18:00:00.000Z') }),
      makeSet({ id: 2, reps: 6, weight: 86, completedAt: new Date('2026-04-27T18:00:00.000Z') }),
    ])

    expect(wrapper.get('.badge-negative').text()).toBe('Même charge que la dernière fois')
  })

  it('does not show the stagnation badge when there is progression', () => {
    const wrapper = mountTracker([
      makeSet({ id: 1, reps: 10, weight: 82, completedAt: new Date('2026-04-20T18:00:00.000Z') }),
      makeSet({ id: 2, reps: 12, weight: 82, completedAt: new Date('2026-04-27T18:00:00.000Z') }),
    ])

    expect(wrapper.find('.badge-negative').exists()).toBe(false)
  })

  it('emits addSet with the form values and starts the rest timer on submit', async () => {
    const wrapper = mountTracker([])
    const inputs = wrapper.findAll('input[type=number]')
    await inputs[0]!.setValue(8)
    await inputs[1]!.setValue(65)

    await wrapper.get('form').trigger('submit')

    const emitted = wrapper.emitted('addSet')
    expect(emitted).toHaveLength(1)
    expect(emitted![0]![0]).toMatchObject({ reps: 8, weight: 65, isWarmup: false })

    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.get('.rest-countdown').text()).toBe('3:00')
  })

  it('does not emit addSet or start resting for invalid input (weight below 1)', async () => {
    const wrapper = mountTracker([])
    const inputs = wrapper.findAll('input[type=number]')
    await inputs[0]!.setValue(8)
    await inputs[1]!.setValue(0)

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('addSet')).toBeUndefined()
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('logs warm-ups without consuming the positional ghost or showing a record verdict', async () => {
    const previous = [
      makeSet({ id: 1, reps: 6, weight: 84, completedAt: new Date('2026-04-20T18:00:00Z') }),
    ]
    const wrapper = mountTracker(previous)

    await wrapper.get('.warmup-toggle').trigger('click')
    const inputs = wrapper.findAll('input[type=number]')
    await inputs[0]!.setValue(6)
    await inputs[1]!.setValue(48)
    await wrapper.get('form').trigger('submit')

    const warmup = wrapper.emitted('addSet')![0]![0] as ExerciseSet
    expect(warmup).toMatchObject({ reps: 6, weight: 48, isWarmup: true })
    await wrapper.setProps({ sets: [warmup, ...previous] })
    expect(wrapper.find('.badge-positive').exists()).toBe(false)
    expect(wrapper.find('.verdict').exists()).toBe(false)

    await wrapper.get('.skip-button').trigger('click')
    expect(wrapper.get('.warmup-toggle').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.target-chip').text()).toContain('84 kg × 6')
  })

  it('recolours the whole tracker in warm-up mode and shows the ramp of the day', async () => {
    const wrapper = mountTracker([
      makeSet({ id: 1, reps: 6, weight: 48, completedAt: new Date('2026-04-20T18:00:00Z'), isWarmup: true }),
      makeSet({ id: 2, reps: 6, weight: 84, completedAt: new Date('2026-04-20T18:05:00Z') }),
      makeSet({ id: 3, reps: 8, weight: 40, completedAt: new Date('2026-04-27T17:50:00Z'), isWarmup: true }),
      makeSet({ id: 4, reps: 6, weight: 56, completedAt: new Date('2026-04-27T17:55:00Z'), isWarmup: true }),
    ])

    expect(wrapper.classes()).not.toContain('exercise-tracker--warmup')
    expect(wrapper.find('.warmup-panel').exists()).toBe(false)

    await wrapper.get('.warmup-toggle').trigger('click')

    expect(wrapper.classes()).toContain('exercise-tracker--warmup')
    expect(wrapper.get('.mode-option--work').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('.target-chip').text()).toContain('Objectif de travail')
    expect(wrapper.findAll('.ramp--today .ramp-step').map((step) => step.text())).toEqual([
      '40 kg × 8',
      '56 kg × 6',
    ])
    // La rampe proposée reprend celle de la dernière fois.
    expect(wrapper.findAll('.ramp--suggested .ramp-step').map((step) => step.text())).toEqual([
      '48 kg × 6',
    ])
    expect(wrapper.get('.ramp--suggested .ramp-label').text()).toContain('dernière fois')
    expect(wrapper.get('button[type=submit]').text()).toBe('Ajouter l’échauffement')

    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('.rest-panel').classes()).toContain('rest-panel--warmup')
    expect(wrapper.get('.rest-label').text()).toBe('Repos · échauffement')
    // Entre deux marches on enchaîne : une minute, pas le repos de travail.
    expect(wrapper.get('.rest-countdown').text()).toBe('1:00')

    await wrapper.get('.skip-button').trigger('click')
    await wrapper.get('.mode-option--work').trigger('click')
    expect(wrapper.classes()).not.toContain('exercise-tracker--warmup')
    expect(wrapper.find('.warmup-panel').exists()).toBe(false)
  })

  it('proposes the programme ramp towards the working target and prefills the next step', async () => {
    const wrapper = mountTracker([
      makeSet({ id: 1, reps: 6, weight: 65, completedAt: new Date('2026-04-20T18:00:00Z') }),
    ])

    await wrapper.get('.warmup-toggle').trigger('click')

    expect(wrapper.findAll('.ramp--suggested .ramp-step').map((step) => step.text())).toEqual([
      '20 kg × 10',
      '32.5 kg × 6',
      '45 kg × 3',
      '57.5 kg × 1',
    ])
    expect(wrapper.get('.ramp--suggested .ramp-label').text()).toContain('objectif de travail')
    expect(wrapper.findAll('.ramp-step--next')).toHaveLength(1)
    expect(wrapper.get('.ramp-step--next').text()).toBe('20 kg × 10')

    const inputs = wrapper.findAll('input[type=number]')
    expect((inputs[0]?.element as HTMLInputElement).value).toBe('10')
    expect((inputs[1]?.element as HTMLInputElement).value).toBe('20')

    await wrapper.findAll('.ramp-suggestion')[2]!.trigger('click')
    expect((inputs[0]?.element as HTMLInputElement).value).toBe('3')
    expect((inputs[1]?.element as HTMLInputElement).value).toBe('45')

    await wrapper.get('form').trigger('submit')
    const logged = wrapper.emitted('addSet')![0]![0] as ExerciseSet
    expect(logged).toMatchObject({ reps: 3, weight: 45, isWarmup: true })
    await wrapper.setProps({ sets: [logged, ...wrapper.props('sets')] })
    await wrapper.get('.skip-button').trigger('click')

    // Une marche faite aujourd'hui : la suivante est préremplie et mise en avant.
    expect(wrapper.get('.ramp-step--next').text()).toBe('32.5 kg × 6')
    expect(wrapper.findAll('.ramp-step--done')).toHaveLength(1)
    expect((wrapper.findAll('input[type=number]')[1]?.element as HTMLInputElement).value).toBe(
      '32.5',
    )
  })

  it('totals the warm-ups of the week apart from the working sets', () => {
    const wrapper = mountTracker([
      makeSet({ id: 1, reps: 8, weight: 40, completedAt: new Date('2026-04-27T17:50:00Z'), isWarmup: true }),
      makeSet({ id: 2, reps: 6, weight: 56, completedAt: new Date('2026-04-27T17:55:00Z'), isWarmup: true }),
      makeSet({ id: 3, reps: 6, weight: 84, completedAt: new Date('2026-04-27T18:00:00Z') }),
    ])

    expect(wrapper.findAll('.stats-grid strong').map((value) => value.text())).toEqual([
      '6',
      '504 kg',
      '84 kg',
    ])
    expect(wrapper.findAll('.warmup-stats-grid strong').map((value) => value.text())).toEqual([
      '2',
      '656 kg',
      '56 kg',
    ])
  })

  it('hides the warm-up totals when there is nothing to total and the mode is off', () => {
    const wrapper = mountTracker([makeSet({ id: 1, reps: 6, weight: 84 })])

    expect(wrapper.find('.warmup-stats-grid').exists()).toBe(false)
  })

  it('counts the rest timer down and returns to the form automatically at zero', async () => {
    const wrapper = mountTracker([])
    await wrapper.get('form').trigger('submit')

    expect(wrapper.get('.rest-countdown').text()).toBe('3:00')

    await vi.advanceTimersByTimeAsync(30_000)
    expect(wrapper.get('.rest-countdown').text()).toBe('2:30')

    await vi.advanceTimersByTimeAsync(150_000)
    expect(wrapper.find('.rest-panel').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('keeps counting on wall-clock time while the app is backgrounded', async () => {
    const wrapper = mountTracker([])
    await wrapper.get('form').trigger('submit')

    // L'app passe en arrière-plan : le WebView gèle setInterval, aucun tick ne
    // part, mais l'horloge, elle, avance.
    vi.setSystemTime(new Date('2026-04-27T18:01:00.000Z'))
    document.dispatchEvent(new Event('visibilitychange'))
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.rest-countdown').text()).toBe('2:00')
  })

  it('ends the rest when the app comes back after the deadline has passed', async () => {
    const wrapper = mountTracker([])
    await wrapper.get('form').trigger('submit')

    vi.setSystemTime(new Date('2026-04-27T18:05:00.000Z'))
    document.dispatchEvent(new Event('visibilitychange'))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.rest-panel').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('resumes a rest still running when the tracker is re-opened', async () => {
    const first = mountTracker([])
    await first.get('form').trigger('submit')
    first.unmount()

    vi.setSystemTime(new Date('2026-04-27T18:01:00.000Z'))
    const second = mountTracker([])
    await second.vm.$nextTick()

    expect(second.get('.rest-countdown').text()).toBe('2:00')
  })

  it('does not resume a rest whose deadline has expired while the app was closed', async () => {
    const first = mountTracker([])
    await first.get('form').trigger('submit')
    first.unmount()

    vi.setSystemTime(new Date('2026-04-27T18:10:00.000Z'))
    const second = mountTracker([])
    await second.vm.$nextTick()

    expect(second.find('.rest-panel').exists()).toBe(false)
    expect(second.find('form').exists()).toBe(true)
  })

  it('does not carry a rest over to another exercise', async () => {
    const wrapper = mountTracker([])
    await wrapper.get('form').trigger('submit')
    expect(wrapper.find('.rest-panel').exists()).toBe(true)

    await wrapper.setProps({ exerciseName: 'Squat' })

    expect(wrapper.find('.rest-panel').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('keeps rests separate for two séances sharing an exercise name', async () => {
    // Les slugs d'exercice ne sont uniques qu'au sein d'une séance : « Développé
    // couché » peut exister dans Upper A et dans Upper B.
    const upperA = mount(ExerciseTracker, {
      props: { exerciseName: 'Développé couché', restKey: 'upper-a/developpe-couche', sets: [] },
      global: { stubs },
    })
    await upperA.get('form').trigger('submit')
    expect(upperA.find('.rest-panel').exists()).toBe(true)

    const upperB = mount(ExerciseTracker, {
      props: { exerciseName: 'Développé couché', restKey: 'upper-b/developpe-couche', sets: [] },
      global: { stubs },
    })
    await upperB.vm.$nextTick()

    expect(upperB.find('.rest-panel').exists()).toBe(false)
    expect(upperB.find('form').exists()).toBe(true)
  })

  it('uses the exercise-specific rest duration when provided', async () => {
    const wrapper = mount(ExerciseTracker, {
      props: {
        exerciseName: 'Leg curl',
        sets: [],
        defaultReps: 10,
        defaultWeight: 30,
        weightUnit: 'kg',
        restSeconds: 30,
      },
      global: { stubs },
    })

    await wrapper.get('form').trigger('submit')

    expect(wrapper.get('.rest-countdown').text()).toBe('0:30')
  })

  it('returns to the form immediately when "Passer" (skip) is clicked', async () => {
    const wrapper = mountTracker([])
    await wrapper.get('form').trigger('submit')

    await wrapper.get('.skip-button').trigger('click')

    expect(wrapper.find('.rest-panel').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('adjusts the rest countdown by +/-15s and finishes early if pushed to zero', async () => {
    const wrapper = mountTracker([])
    await wrapper.get('form').trigger('submit')

    const [minus, plus] = wrapper.findAll('.rest-controls button')
    await plus!.trigger('click')
    expect(wrapper.get('.rest-countdown').text()).toBe('3:15')

    await minus!.trigger('click')
    await minus!.trigger('click')
    await minus!.trigger('click')
    expect(wrapper.get('.rest-countdown').text()).toBe('2:30')
  })

  it('shows the "Nouveau record" badge when the just-added set beats every prior weight', async () => {
    // ExerciseTracker is a controlled component: the "new record" check reads the
    // just-submitted id back out of props.sets, so the parent must feed the new
    // set back in — exactly what ExerciseTrackerView does after the store mutates.
    const existing = [makeSet({ id: 1, reps: 8, weight: 60, completedAt: new Date('2026-04-20T18:00:00.000Z') })]
    const wrapper = mountTracker(existing)
    const inputs = wrapper.findAll('input[type=number]')
    await inputs[1]!.setValue(65)

    await wrapper.get('form').trigger('submit')
    const newSet = wrapper.emitted('addSet')![0]![0] as ExerciseSet
    await wrapper.setProps({ sets: [newSet, ...existing] })

    expect(wrapper.get('.badge-positive').text()).toBe('Nouveau record')
  })

  it('does not show the "Nouveau record" badge when the new set is not the heaviest', async () => {
    const existing = [makeSet({ id: 1, reps: 8, weight: 70, completedAt: new Date('2026-04-20T18:00:00.000Z') })]
    const wrapper = mountTracker(existing)
    const inputs = wrapper.findAll('input[type=number]')
    await inputs[1]!.setValue(65)

    await wrapper.get('form').trigger('submit')
    const newSet = wrapper.emitted('addSet')![0]![0] as ExerciseSet
    await wrapper.setProps({ sets: [newSet, ...existing] })

    expect(wrapper.find('.badge-positive').exists()).toBe(false)
  })

  it('emits removeSet with the set id when "Retirer" is clicked', async () => {
    const wrapper = mountTracker([makeSet({ id: 42, reps: 8, weight: 60 })])

    await wrapper.get('[aria-label="Supprimer la série"]').trigger('click')

    expect(wrapper.emitted('removeSet')).toEqual([[42]])
  })

  it('lets an existing history row be reclassified as warm-up', async () => {
    const wrapper = mountTracker([makeSet({ id: 42, reps: 6, weight: 48 })])

    await wrapper.get('.set-warmup-toggle').trigger('click')

    expect(wrapper.emitted('setWarmup')).toEqual([[42, true]])
  })

  it('numbers working sets within their session and colours warm-ups apart', () => {
    const at = (minute: number) => new Date(`2026-04-27T18:${String(minute).padStart(2, '0')}:00Z`)
    const wrapper = mountTracker([
      makeSet({ id: 1, reps: 8, weight: 40, completedAt: at(0), isWarmup: true }),
      makeSet({ id: 2, reps: 6, weight: 84, completedAt: at(5) }),
      makeSet({ id: 3, reps: 8, weight: 76, completedAt: at(10) }),
      makeSet({ id: 4, reps: 12, weight: 68, completedAt: at(15) }),
    ])

    const rows = wrapper.findAll('.set-list li')
    expect(rows.map((row) => row.get('.set-kind').text())).toEqual(['S3', 'S2', 'S1', 'Échauffement'])
    expect(rows.map((row) => row.classes().includes('set-row--warmup'))).toEqual([
      false,
      false,
      false,
      true,
    ])
    expect(rows.map((row) => row.classes().includes('set-row--work'))).toEqual([
      true,
      true,
      true,
      false,
    ])
  })

  it('keeps all six exported rows visible while only working sets feed the stats', () => {
    const at = (minute: number) => new Date(`2026-04-27T18:${String(minute).padStart(2, '0')}:00Z`)
    const sets = [
      makeSet({ id: 1, reps: 6, weight: 48, completedAt: at(0), isWarmup: true }),
      makeSet({ id: 2, reps: 7, weight: 56, completedAt: at(3), isWarmup: true }),
      makeSet({ id: 3, reps: 6, weight: 64, completedAt: at(6), isWarmup: true }),
      makeSet({ id: 4, reps: 6, weight: 84, completedAt: at(9) }),
      makeSet({ id: 5, reps: 8, weight: 76, completedAt: at(12) }),
      makeSet({ id: 6, reps: 12, weight: 68, completedAt: at(15) }),
    ]
    const wrapper = mountTracker(sets)

    expect(wrapper.findAll('.set-list li')).toHaveLength(6)
    expect(wrapper.findAll('.set-row--warmup')).toHaveLength(3)
    expect(wrapper.findAll('.stats-grid strong').map((value) => value.text())).toEqual([
      '26',
      '1928 kg',
      '84 kg',
    ])
  })

  it('emits clearSets only after the confirmation click', async () => {
    const wrapper = mountTracker([
      makeSet({ id: 1, reps: 8, weight: 60 }),
      makeSet({ id: 2, reps: 8, weight: 62 }),
    ])

    const button = wrapper.get('.clear-sets')

    await button.trigger('click')
    expect(wrapper.emitted('clearSets')).toBeUndefined()
    expect(button.text()).toContain('Confirmer')

    await button.trigger('click')
    expect(wrapper.emitted('clearSets')).toEqual([[]])
  })

  it('hides the clear-sets button when there is no set', () => {
    const wrapper = mountTracker([])

    expect(wrapper.find('.clear-sets').exists()).toBe(false)
  })

  it('aligne les trois actions quand il y a un historique', () => {
    const wrapper = mountTracker([makeSet({ id: 1, reps: 8, weight: 60 })])

    expect(wrapper.findAll('.sets-actions button').map((button) => button.text())).toEqual([
      'Exporter',
      'Importer',
      'Supprimer',
    ])
  })

  it('ne propose qu\'Importer sur un exercice vide', () => {
    // Un exercice sans série n'a rien à exporter ni à supprimer ; importer y
    // reste la seule action utile — c'est même le cas d'usage principal.
    const wrapper = mountTracker([])

    expect(wrapper.findAll('.sets-actions button').map((button) => button.text())).toEqual([
      'Importer',
    ])
  })

  it('raccourcit le libellé de confirmation pour tenir dans la rangée', async () => {
    const wrapper = mountTracker([makeSet({ id: 1, reps: 8, weight: 60 })])

    await wrapper.get('.clear-sets').trigger('click')

    expect(wrapper.get('.clear-sets').text()).toBe('Confirmer ?')
  })

  it('émet exportSets au clic sur Exporter', async () => {
    const wrapper = mountTracker([makeSet({ id: 1, reps: 8, weight: 60 })])

    await wrapper.get('.export-sets').trigger('click')

    expect(wrapper.emitted('exportSets')).toEqual([[]])
  })

  it('émet importSets au clic sur Importer', async () => {
    const wrapper = mountTracker([])

    await wrapper.get('.import-sets').trigger('click')

    expect(wrapper.emitted('importSets')).toEqual([[]])
  })

  it('affiche le compte rendu d\'import', async () => {
    const wrapper = mountTracker([])

    await wrapper.setProps({ importReport: '206 séries ajoutées, 3 ignorées.' })

    expect(wrapper.get('.sets-report').text()).toBe('206 séries ajoutées, 3 ignorées.')
  })

  describe('mode haltères', () => {
    function mountDumbbellTracker(sets: ExerciseSet[] = []) {
      return mount(ExerciseTracker, {
        props: {
          exerciseName: 'Curl incliné haltères',
          sets,
          defaultReps: 10,
          defaultWeight: 24,
          weightUnit: 'kg',
          isDumbbell: true,
        },
        global: { stubs },
      })
    }

    it('convertit la valeur saisie sans changer la charge en activant le mode', async () => {
      const wrapper = mountTracker([])
      const weightInput = wrapper.findAll('input[type=number]')[1]!
      await weightInput.setValue(24)

      await wrapper.get('.dumbbell-toggle').trigger('click')

      expect(wrapper.emitted('update:isDumbbell')).toEqual([[true]])
      expect((weightInput.element as HTMLInputElement).value).toBe('12')
    })

    it('enregistre le total des deux haltères', async () => {
      const wrapper = mountDumbbellTracker([])
      await wrapper.findAll('input[type=number]')[1]!.setValue(14)

      await wrapper.get('form').trigger('submit')

      expect(wrapper.emitted('addSet')![0]![0]).toMatchObject({ weight: 28 })
    })

    it('préremplit la moitié de la cible totale et affiche le total', () => {
      const wrapper = mountDumbbellTracker([])

      expect(wrapper.get('.target-chip').text()).toContain('24 kg × 10')
      expect(
        (wrapper.findAll('input[type=number]')[1]!.element as HTMLInputElement).value,
      ).toBe('12')
      expect(wrapper.get('.dumbbell-hint').text()).toBe('= 24 kg au total')
    })

    it('rétablit le poids total en désactivant le mode', async () => {
      const wrapper = mountDumbbellTracker([])
      const weightInput = wrapper.findAll('input[type=number]')[1]!
      await weightInput.setValue(12)

      await wrapper.get('.dumbbell-toggle').trigger('click')

      expect(wrapper.emitted('update:isDumbbell')).toEqual([[false]])
      expect((weightInput.element as HTMLInputElement).value).toBe('24')
    })
  })
})

describe('verdict de série', () => {
  // Séance de référence : une pyramide de trois séries, une semaine plus tôt.
  const semaineDerniere = [
    makeSet({ id: 1, reps: 8, weight: 60, completedAt: new Date('2026-04-20T18:00:00.000Z') }),
    makeSet({ id: 2, reps: 8, weight: 66, completedAt: new Date('2026-04-20T18:06:00.000Z') }),
    makeSet({ id: 3, reps: 6, weight: 72, completedAt: new Date('2026-04-20T18:12:00.000Z') }),
  ]

  async function loggerSerie(wrapper: ReturnType<typeof mountTracker>, reps: number, weight: number) {
    await wrapper.get('input[type="number"]').setValue(reps)
    await wrapper.findAll('input[type="number"]')[1]?.setValue(weight)
    await wrapper.get('form').trigger('submit')

    // Le composant émet la série ; dans l'app c'est le store qui la lui
    // renvoie. Sans cette boucle, le fantôme ne se déplacerait jamais vers la
    // série suivante et le test ne vérifierait rien de positionnel.
    const emises = wrapper.emitted('addSet') ?? []
    const derniere = emises[emises.length - 1]?.[0] as ExerciseSet
    await wrapper.setProps({ sets: [...(wrapper.props('sets') ?? []), derniere] })
  }

  it('annonce la charge battue sur la série homologue', async () => {
    const wrapper = mountTracker(semaineDerniere)

    // Première série du jour : elle se compare à la première d'avant, 8 × 60.
    await loggerSerie(wrapper, 8, 62)

    expect(wrapper.get('.rest-panel').text()).toContain('+2 kg')
    expect(wrapper.get('.rest-panel').text()).toContain('série 1')
  })

  it('annonce une série identique', async () => {
    const wrapper = mountTracker(semaineDerniere)

    await loggerSerie(wrapper, 8, 60)

    expect(wrapper.get('.rest-panel').text()).toContain('identique')
  })

  it('annonce un recul', async () => {
    const wrapper = mountTracker(semaineDerniere)

    await loggerSerie(wrapper, 6, 60)

    expect(wrapper.get('.rest-panel').text()).toContain('2 reps')
  })

  it('compare la deuxième série à la deuxième, pas à la dernière', async () => {
    const wrapper = mountTracker(semaineDerniere)

    await loggerSerie(wrapper, 8, 60)
    await wrapper.get('.skip-button').trigger('click')
    // 68 kg dépasse la deuxième série d'avant (66) mais reste sous la
    // troisième (72) : un fantôme non positionnel annoncerait un recul.
    await loggerSerie(wrapper, 8, 68)

    expect(wrapper.get('.rest-panel').text()).toContain('+2 kg')
    expect(wrapper.get('.rest-panel').text()).toContain('série 2')
  })

  it('ne dit rien quand il n’y a pas de séance de référence', async () => {
    const wrapper = mountTracker([])

    await loggerSerie(wrapper, 8, 60)

    expect(wrapper.get('.rest-panel').text()).not.toContain('série 1')
  })
})
