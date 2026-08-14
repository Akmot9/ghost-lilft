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
    expect(wrapper.get('.target-chip').text()).toContain('62 kg × 9')

    const inputs = wrapper.findAll('input[type=number]')
    expect((inputs[0]?.element as HTMLInputElement).value).toBe('9')
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
    expect(wrapper.get('.rest-countdown').text()).toBe('1:30')
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

    expect(wrapper.get('.rest-countdown').text()).toBe('1:30')

    await vi.advanceTimersByTimeAsync(30_000)
    expect(wrapper.get('.rest-countdown').text()).toBe('1:00')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(wrapper.find('.rest-panel').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(true)
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
    expect(wrapper.get('.rest-countdown').text()).toBe('1:45')

    await minus!.trigger('click')
    await minus!.trigger('click')
    await minus!.trigger('click')
    expect(wrapper.get('.rest-countdown').text()).toBe('1:00')
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
