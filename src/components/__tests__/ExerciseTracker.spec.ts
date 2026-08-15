import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ExerciseTracker from '../ExerciseTracker.vue'
import type { ExerciseSet } from '../../lib/trainingInsights'
import { makeSet } from '../../lib/__tests__/testFactories'

const stubs = { SessionDiff: true, WeeklyVolumeGraph: true }

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
    expect(emitted![0]![0]).toMatchObject({ reps: 8, weight: 65 })

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
