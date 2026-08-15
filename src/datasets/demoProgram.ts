import type { Exercise, Seance } from '../stores/seances'

/**
 * Programme d'exemple du mode découverte : trois séances, huit semaines
 * d'historique, généré relativement à la date d'installation.
 *
 * Les dates sont relatives et non figées dans un fichier : un historique daté
 * en dur sort avec le temps des fenêtres hebdomadaires calculées par
 * `trainingInsights`, et le nouvel utilisateur découvre alors un dashboard
 * vide — ce qui est arrivé au jeu de données précédent, semé en 2025. Ici
 * l'historique est écrit en base au premier lancement, donc figé pour cet
 * utilisateur, mais toujours récent au moment où il découvre l'app.
 *
 * Chaque séance raconte délibérément une chose que l'app sait faire :
 * Upper A progresse franchement, Lower finit par stagner — ce qui alimente
 * l'alerte du dashboard —, et Upper B traverse une semaine en baisse avant de
 * repartir, ce qui fait exister la couleur des semaines en recul et la
 * moyenne mobile qui les lisse.
 */

const WEEKS = 8
const DAY_MS = 24 * 60 * 60 * 1000

type SessionPlan = {
  reps: number
  /** Une charge par semaine, de la plus ancienne à la plus récente. */
  weights: number[]
  /** Nombre de séries identiques par séance. */
  sets: number
}

type ExercisePlan = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  restSeconds: number
  history?: SessionPlan
}

/**
 * Les identifiants de séries sont attribués sur l'ensemble du programme, pas
 * par exercice : `sets.id` est une clé primaire globale, et deux exercices
 * porteurs d'historique repartant de 1 entreraient en collision dès
 * l'insertion, faisant échouer tout le semis.
 */
function createProgram(now: Date): Seance[] {
  let nextSetId = 1

  function buildExercise(plan: ExercisePlan): Exercise {
    const sets = []

    if (plan.history) {
      for (let week = WEEKS; week >= 1; week -= 1) {
        const weight = plan.history.weights[WEEKS - week]

        if (weight === undefined) {
          continue
        }

        for (let index = 0; index < plan.history.sets; index += 1) {
          const completedAt = new Date(now.getTime() - week * 7 * DAY_MS)
          // Heure fixée en UTC : les séances sont regroupées par jour UTC, une
          // heure locale ferait basculer une série d'un jour à l'autre selon le
          // fuseau de l'appareil.
          completedAt.setUTCHours(18, index * 10, 0, 0)

          sets.push({
            id: nextSetId++,
            reps: plan.history.reps,
            weight,
            completedAt,
          })
        }
      }
    }

    return {
      slug: plan.slug,
      name: plan.name,
      defaultReps: plan.defaultReps,
      defaultWeight: plan.defaultWeight,
      weightUnit: 'kg',
      restSeconds: plan.restSeconds,
      sets,
    }
  }

  function buildSeance(slug: string, name: string, exercises: ExercisePlan[]): Seance {
    return { slug, name, isDemo: true, exercises: exercises.map(buildExercise) }
  }

  return [
    buildSeance('upper-a', 'Upper A', [
      {
        slug: 'developpe-incline',
        name: 'Développé incliné',
        defaultReps: 6,
        defaultWeight: 54,
        restSeconds: 150,
        history: { reps: 6, sets: 3, weights: [40, 42, 44, 46, 48, 50, 52, 54] },
      },
      {
        slug: 'tractions-lestees',
        name: 'Tractions lestées',
        defaultReps: 6,
        defaultWeight: 12,
        restSeconds: 120,
        history: { reps: 6, sets: 3, weights: [5, 6, 7, 8, 9, 10, 11, 12] },
      },
      {
        slug: 'elevations-frontales',
        name: 'Élévations frontales',
        defaultReps: 12,
        defaultWeight: 8,
        restSeconds: 90,
      },
      {
        slug: 'curl-incline-halteres',
        name: 'Curl incliné haltères',
        defaultReps: 10,
        defaultWeight: 10,
        restSeconds: 90,
      },
      {
        slug: 'elevations-laterales',
        name: 'Élévations latérales',
        defaultReps: 18,
        defaultWeight: 8,
        restSeconds: 60,
      },
    ]),

    buildSeance('lower', 'Lower', [
      {
        slug: 'high-bar-squat',
        name: 'High bar squat',
        defaultReps: 8,
        defaultWeight: 80,
        restSeconds: 120,
        // Les trois dernières semaines à charge et répétitions identiques :
        // c'est ce qui déclenche l'alerte de stagnation du dashboard.
        history: { reps: 8, sets: 3, weights: [60, 64, 68, 72, 76, 80, 80, 80] },
      },
      {
        slug: 'romanian-deadlift',
        name: 'Romanian deadlift',
        defaultReps: 12,
        defaultWeight: 54,
        restSeconds: 90,
        history: { reps: 12, sets: 3, weights: [40, 42, 44, 46, 48, 50, 52, 54] },
      },
      { slug: 'leg-curl', name: 'Leg curl', defaultReps: 10, defaultWeight: 30, restSeconds: 30 },
      {
        slug: 'leg-extension',
        name: 'Leg extension',
        defaultReps: 10,
        defaultWeight: 30,
        restSeconds: 30,
      },
      {
        slug: 'extensions-mollets',
        name: 'Extensions mollets',
        defaultReps: 13,
        defaultWeight: 40,
        restSeconds: 60,
      },
      {
        slug: 'upright-row-penche',
        name: 'Upright row penché',
        defaultReps: 18,
        defaultWeight: 20,
        restSeconds: 60,
      },
    ]),

    buildSeance('upper-b', 'Upper B', [
      {
        slug: 'developpe-couche',
        name: 'Développé couché',
        defaultReps: 8,
        defaultWeight: 72,
        restSeconds: 120,
        // Semaine 5 en retrait — une mauvaise semaine, puis la reprise.
        history: { reps: 8, sets: 3, weights: [60, 62, 64, 66, 62, 68, 70, 72] },
      },
      {
        slug: 'overhead-press',
        name: 'Overhead press',
        defaultReps: 6,
        defaultWeight: 36,
        restSeconds: 150,
        history: { reps: 6, sets: 3, weights: [30, 31, 32, 33, 31, 34, 35, 36] },
      },
      {
        slug: 'tractions-neutres',
        name: 'Tractions neutres',
        defaultReps: 10,
        defaultWeight: 5,
        restSeconds: 90,
      },
      {
        slug: 'oiseau-assis-prise-neutre',
        name: 'Oiseau assis prise neutre',
        defaultReps: 12,
        defaultWeight: 10,
        restSeconds: 60,
      },
      {
        slug: 'upright-row',
        name: 'Upright row',
        defaultReps: 13,
        defaultWeight: 20,
        restSeconds: 60,
      },
    ]),
  ]
}

export function createDemoSeances(now: Date = new Date()): Seance[] {
  return createProgram(now)
}
