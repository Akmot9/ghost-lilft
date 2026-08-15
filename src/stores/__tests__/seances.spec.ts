import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSeanceStore } from '../seances'
import { parseBackup, serializeBackup } from '../../lib/backup'
import { scenarios } from '../../datasets/scenarios'

const NOW = new Date('2026-08-15T09:00:00.000Z')

// These tests exercise the in-memory fallback path: there is no real Tauri
// runtime in a Vitest/jsdom environment, so runningInTauri() resolves to
// false and every action operates purely on the reactive state — the same
// path a plain `npm run dev` browser session uses.

describe('useSeanceStore (in-memory fallback)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts empty before init()', () => {
    const store = useSeanceStore()

    expect(store.seances).toEqual([])
    expect(store.hasOnboarded).toBe(false)
  })

  it('seeds the 3-day starter program on init()', async () => {
    const store = useSeanceStore()

    await store.init()

    expect(store.hasOnboarded).toBe(true)
    expect(store.seances.map((seance) => seance.slug)).toEqual(['upper-a', 'lower', 'upper-b'])
    expect(store.seances.every((seance) => seance.isDemo)).toBe(true)
    expect(store.hasDemoData).toBe(true)

    // Le développé couché (Upper B) porte l'historique de démonstration.
    const bench = store.findExercise('upper-b', 'developpe-couche')
    expect(bench?.sets.length).toBeGreaterThan(0)
    expect(bench?.restSeconds).toBe(120)

    // Le repos est propre à chaque exercice.
    expect(store.findExercise('upper-a', 'developpe-incline')?.restSeconds).toBe(150)
    expect(store.findExercise('lower', 'leg-curl')?.restSeconds).toBe(30)
  })

  describe('clearSets', () => {
    it('removes every set of the exercise at once', async () => {
      const store = useSeanceStore()
      const seanceSlug = await store.createSeance('Leg Day', [
        { name: 'Squat', defaultReps: 5, defaultWeight: 80, weightUnit: 'kg' },
      ])
      await store.addSet(seanceSlug, 'squat', {
        id: 1,
        reps: 5,
        weight: 80,
        completedAt: new Date('2026-08-01T10:00:00Z'),
      })
      await store.addSet(seanceSlug, 'squat', {
        id: 2,
        reps: 5,
        weight: 85,
        completedAt: new Date('2026-08-01T10:05:00Z'),
      })

      await store.clearSets(seanceSlug, 'squat')

      expect(store.findExercise(seanceSlug, 'squat')?.sets).toEqual([])
    })

    it('leaves other exercises untouched', async () => {
      const store = useSeanceStore()
      const seanceSlug = await store.createSeance('Full Body', [
        { name: 'Squat', defaultReps: 5, defaultWeight: 80, weightUnit: 'kg' },
        { name: 'Rowing', defaultReps: 8, defaultWeight: 40, weightUnit: 'kg' },
      ])
      await store.addSet(seanceSlug, 'squat', {
        id: 1,
        reps: 5,
        weight: 80,
        completedAt: new Date('2026-08-01T10:00:00Z'),
      })
      await store.addSet(seanceSlug, 'rowing', {
        id: 2,
        reps: 8,
        weight: 40,
        completedAt: new Date('2026-08-01T10:05:00Z'),
      })

      await store.clearSets(seanceSlug, 'squat')

      expect(store.findExercise(seanceSlug, 'squat')?.sets).toEqual([])
      expect(store.findExercise(seanceSlug, 'rowing')?.sets).toHaveLength(1)
    })
  })

  describe('adoptDemoSeances', () => {
    it('keeps the séances but clears the example history and demo flags', async () => {
      const store = useSeanceStore()

      await store.init()
      await store.adoptDemoSeances()

      expect(store.seances.map((seance) => seance.slug)).toEqual(['upper-a', 'lower', 'upper-b'])
      expect(store.hasDemoData).toBe(false)
      expect(store.hasOnboarded).toBe(true)
      expect(store.findExercise('upper-b', 'developpe-couche')?.sets).toEqual([])
      // Les repos par exercice du programme sont conservés.
      expect(store.findExercise('upper-a', 'developpe-incline')?.restSeconds).toBe(150)
    })
  })

  describe('deleteDemoData', () => {
    it('removes the seeded séance and reports no demo data left', async () => {
      const store = useSeanceStore()

      await store.init()
      await store.deleteDemoData()

      expect(store.seances).toEqual([])
      expect(store.hasDemoData).toBe(false)
      expect(store.hasOnboarded).toBe(false)
    })

    it('keeps user-created séances untouched', async () => {
      const store = useSeanceStore()

      await store.init()
      await store.createSeance('Push Day', [
        { name: 'Développé couché', defaultReps: 5, defaultWeight: 60, weightUnit: 'kg' },
      ])
      await store.deleteDemoData()

      expect(store.seances.map((seance) => seance.slug)).toEqual(['push-day'])
      expect(store.hasDemoData).toBe(false)
      expect(store.hasOnboarded).toBe(true)
    })
  })

  it('init() is idempotent (calling it twice does not duplicate the seed)', async () => {
    const store = useSeanceStore()

    await store.init()
    await store.init()

    expect(store.seances).toHaveLength(3)
  })

  describe('createSeance', () => {
    it('rejects a séance with no exercises', async () => {
      const store = useSeanceStore()

      await expect(
        store.createSeance('Séance vide', []),
      ).rejects.toThrow()
    })

    it('creates a séance with a slugified name and returns its slug', async () => {
      const store = useSeanceStore()

      const slug = await store.createSeance('Push Day', [
        { name: 'Développé couché', defaultReps: 5, defaultWeight: 60, weightUnit: 'kg' },
      ])

      expect(slug).toBe('push-day')
      expect(store.findSeanceBySlug('push-day')?.name).toBe('Push Day')
      expect(store.findSeanceBySlug('push-day')?.exercises).toHaveLength(1)
    })

    it('disambiguates a séance slug that already exists', async () => {
      const store = useSeanceStore()
      const exercises = [{ name: 'Squat', defaultReps: 5, defaultWeight: 60, weightUnit: 'kg' }]

      const firstSlug = await store.createSeance('Push Day', exercises)
      const secondSlug = await store.createSeance('Push Day', exercises)

      expect(firstSlug).toBe('push-day')
      expect(secondSlug).toBe('push-day-2')
    })

    it('falls back to "kg" when no weight unit is given', async () => {
      const store = useSeanceStore()

      const slug = await store.createSeance('Séance', [
        { name: 'Curl', defaultReps: 10, defaultWeight: 15, weightUnit: '' },
      ])

      expect(store.findSeanceBySlug(slug)?.exercises[0]?.weightUnit).toBe('kg')
    })
  })

  describe('renameSeance', () => {
    it('renames an existing séance', async () => {
      const store = useSeanceStore()
      const slug = await store.createSeance('Old Name', [
        { name: 'Squat', defaultReps: 5, defaultWeight: 60, weightUnit: 'kg' },
      ])

      await store.renameSeance(slug, 'New Name')

      expect(store.findSeanceBySlug(slug)?.name).toBe('New Name')
    })

    it('does nothing for an unknown séance slug', async () => {
      const store = useSeanceStore()

      await expect(store.renameSeance('does-not-exist', 'X')).resolves.not.toThrow()
    })
  })

  describe('addExerciseToSeance', () => {
    it('adds an exercise and keeps its slug unique within the séance', async () => {
      const store = useSeanceStore()
      const seanceSlug = await store.createSeance('Séance', [
        { name: 'Squat', defaultReps: 5, defaultWeight: 60, weightUnit: 'kg' },
      ])

      await store.addExerciseToSeance(seanceSlug, {
        name: 'Squat',
        defaultReps: 5,
        defaultWeight: 80,
        weightUnit: 'kg',
      })

      const seance = store.findSeanceBySlug(seanceSlug)
      expect(seance?.exercises.map((exercise) => exercise.slug)).toEqual(['squat', 'squat-2'])
    })

    it('returns null for an unknown séance slug', async () => {
      const store = useSeanceStore()

      const result = await store.addExerciseToSeance('does-not-exist', {
        name: 'Squat',
        defaultReps: 5,
        defaultWeight: 60,
        weightUnit: 'kg',
      })

      expect(result).toBeNull()
    })
  })

  describe('addSet / removeSet', () => {
    it('adds a set to the front of the exercise sets list', async () => {
      const store = useSeanceStore()
      const seanceSlug = await store.createSeance('Séance', [
        { name: 'Squat', defaultReps: 5, defaultWeight: 60, weightUnit: 'kg' },
      ])

      await store.addSet(seanceSlug, 'squat', {
        id: 1,
        reps: 8,
        weight: 60,
        completedAt: new Date('2026-01-01T18:00:00.000Z'),
      })

      expect(store.findExercise(seanceSlug, 'squat')?.sets).toHaveLength(1)
    })

    it('removes a set by id', async () => {
      const store = useSeanceStore()
      const seanceSlug = await store.createSeance('Séance', [
        { name: 'Squat', defaultReps: 5, defaultWeight: 60, weightUnit: 'kg' },
      ])
      await store.addSet(seanceSlug, 'squat', {
        id: 1,
        reps: 8,
        weight: 60,
        completedAt: new Date('2026-01-01T18:00:00.000Z'),
      })

      await store.removeSet(seanceSlug, 'squat', 1)

      expect(store.findExercise(seanceSlug, 'squat')?.sets).toEqual([])
    })
  })

  describe('allSets getter', () => {
    it('flattens sets across every séance and exercise', async () => {
      const store = useSeanceStore()
      const seanceSlug = await store.createSeance('Séance', [
        { name: 'Squat', defaultReps: 5, defaultWeight: 60, weightUnit: 'kg' },
        { name: 'Bench', defaultReps: 5, defaultWeight: 60, weightUnit: 'kg' },
      ])
      await store.addSet(seanceSlug, 'squat', {
        id: 1,
        reps: 8,
        weight: 60,
        completedAt: new Date('2026-01-01T18:00:00.000Z'),
      })
      await store.addSet(seanceSlug, 'bench', {
        id: 2,
        reps: 6,
        weight: 70,
        completedAt: new Date('2026-01-01T18:00:00.000Z'),
      })

      expect(store.allSets.map((set) => set.id).sort()).toEqual([1, 2])
    })
  })

  describe('sauvegarde', () => {
    it('hasRealData est faux tant que tout est de la démonstration', () => {
      const store = useSeanceStore()
      store.seances = scenarios.progression(NOW).map((seance) => ({ ...seance, isDemo: true }))

      expect(store.hasRealData).toBe(false)
    })

    it('hasRealData devient vrai dès une séance réelle', () => {
      const store = useSeanceStore()
      store.seances = scenarios.progression(NOW)

      expect(store.hasRealData).toBe(true)
    })

    it('exporte l’état courant dans un fichier relisible', () => {
      const store = useSeanceStore()
      store.seances = scenarios.progression(NOW)

      const restored = parseBackup(store.exportBackup())

      expect(restored[0]?.slug).toBe(store.seances[0]?.slug)
      expect(restored[0]?.exercises[0]?.sets).toHaveLength(
        store.seances[0]?.exercises[0]?.sets.length ?? 0,
      )
    })

    it('remplace les données de démonstration par la sauvegarde', async () => {
      const store = useSeanceStore()
      store.seances = scenarios.stagnation(NOW).map((seance) => ({ ...seance, isDemo: true }))

      const backup = serializeBackup(scenarios.progression(NOW), NOW)
      await store.importBackup(backup)

      expect(store.seances.map((seance) => seance.slug)).toEqual(['lower'])
      expect(store.hasDemoData).toBe(false)
    })

    it('refuse d’importer par-dessus des données réelles', async () => {
      const store = useSeanceStore()
      store.seances = scenarios.progression(NOW)

      await expect(
        store.importBackup(serializeBackup(scenarios.stagnation(NOW), NOW)),
      ).rejects.toThrow(/déjà tes propres séances/i)

      expect(store.seances.map((seance) => seance.slug)).toEqual(['lower'])
    })

    it('laisse l’état intact quand le fichier est invalide', async () => {
      const store = useSeanceStore()
      store.seances = scenarios.stagnation(NOW).map((seance) => ({ ...seance, isDemo: true }))

      await expect(store.importBackup('pas du json')).rejects.toThrow(/illisible/i)

      expect(store.seances.map((seance) => seance.slug)).toEqual(['upper-a'])
    })
  })
})
