import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toImportPayload, type Seance } from '../seances'
import { scenarios } from '../../datasets/scenarios'

/**
 * NE SUPPRIME PAS `fixtures/import-payload.json`.
 *
 * Ce fichier est le seul point de contact vérifiable entre TypeScript et Rust.
 * L'app envoie sa charge utile à la commande `import_seances` par IPC : le
 * front sérialise en camelCase, Rust désérialise dans `ImportSeance` /
 * `ImportExercise` / `ImportSet` (`src-tauri/src/lib.rs`). Rien, à la
 * compilation, ne relie les deux moitiés — un `defaultReps` renommé d'un seul
 * côté produit une app qui compile, dont les tests passent, et dont la
 * restauration échoue chez l'utilisateur.
 *
 * Le mécanisme est le suivant :
 *   1. ce test-ci produit la charge utile avec la **vraie** fonction du store,
 *      `toImportPayload`, et la compare octet pour octet au fichier ;
 *   2. le test Rust `the_reference_payload_from_typescript_deserializes` lit
 *      **le même fichier** et le désérialise dans les structures `Import*`.
 *
 * Renommer un champ d'un seul côté fait donc tomber l'un des deux :
 *   - côté TypeScript, le fichier ne correspond plus à ce que produit le store ;
 *   - côté Rust, la désérialisation du fichier échoue sur un champ manquant.
 *
 * Quand le format change **volontairement** (des deux côtés), régénère le
 * fichier :
 *
 *     GHOST_LIFT_UPDATE_FIXTURES=1 npm run test:unit
 *
 * puis relis le diff : c'est exactement ce que l'app enverra à Rust.
 */
// `vitest.config.ts` fixe `root` à la racine du dépôt, et vitest y place le
// répertoire courant : `import.meta.url` ne peut pas servir ici, les modules
// étant servis par vite sous une URL qui n'est pas de schéma `file:`.
const FIXTURE_PATH = resolve(process.cwd(), 'fixtures/import-payload.json')

// Date fixe : les scénarios sont paramétrés par « maintenant ». Sans elle, le
// fichier de référence changerait à chaque exécution et ne référencerait rien.
const NOW = new Date('2026-08-15T09:00:00.000Z')

/**
 * Trois scénarios réunis pour couvrir les formes que la charge utile peut
 * prendre : plusieurs séances, une séance à plusieurs exercices, et un
 * exercice dont `sets` est vide (le `Vec<ImportSet>` vide côté Rust).
 */
function referencePayload() {
  return toImportPayload(
    withGloballyUniqueSetIds([
      ...scenarios.stagnation(NOW),
      ...scenarios.progression(NOW),
      ...scenarios.debutant(NOW),
    ]),
  )
}

/**
 * Les scénarios numérotent leurs séries par exercice (1, 2, 3… à chaque fois) :
 * pratique à lire, mais ce n'est pas ce que porte une vraie sauvegarde. Dans
 * l'app, l'identifiant vient de `sets.id INTEGER PRIMARY KEY AUTOINCREMENT`,
 * donc il est unique sur toute la base. Le fichier de référence doit être une
 * charge utile *importable* — le test Rust ne se contente pas de la
 * désérialiser, il l'écrit vraiment dans une base et la relit.
 */
function withGloballyUniqueSetIds(seances: Seance[]): Seance[] {
  let nextId = 1

  return seances.map((seance) => ({
    ...seance,
    exercises: seance.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, id: nextId++ })),
    })),
  }))
}

/** Forme canonique du fichier : 2 espaces d'indentation, saut de ligne final. */
function serializeFixture(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`
}

describe('charge utile envoyée à la commande Rust import_seances', () => {
  it('correspond au fichier de référence partagé avec Rust', () => {
    const expected = serializeFixture(referencePayload())

    if (process.env.GHOST_LIFT_UPDATE_FIXTURES === '1') {
      writeFileSync(FIXTURE_PATH, expected, 'utf8')
    }

    const onDisk = readFileSync(FIXTURE_PATH, 'utf8')

    expect(
      onDisk,
      'fixtures/import-payload.json ne correspond plus à toImportPayload(). Si le ' +
        'changement est voulu, adapte aussi les structures Import* de ' +
        'src-tauri/src/lib.rs, puis régénère : GHOST_LIFT_UPDATE_FIXTURES=1 npm run test:unit',
    ).toBe(expected)
  })

  it('reste une charge utile digne d’être comparée', () => {
    // Garde-fou : une charge utile dégénérée (vide, sans série) passerait la
    // comparaison ci-dessus sans rien prouver du contrat de désérialisation.
    const payload = referencePayload()

    expect(payload.length).toBeGreaterThan(1)
    expect(payload.some((seance) => seance.exercises.length > 1)).toBe(true)
    expect(payload.some((seance) => seance.exercises.some((exercise) => exercise.sets.length > 0)))
      .toBe(true)
    expect(
      payload.some((seance) => seance.exercises.some((exercise) => exercise.sets.length === 0)),
    ).toBe(true)
  })

  it('n’envoie que les champs que Rust sait lire', () => {
    // Les noms sont dupliqués ici à dessein : le fichier de référence dit
    // « voilà ce qu'on envoie », cette liste dit « voilà ce dont on a le droit
    // de parler ». Un champ ajouté côté TypeScript sans son pendant Rust
    // (`#[serde(deny_unknown_fields)]` n'étant pas posé, serde l'ignorerait en
    // silence) tombe ici.
    const [seance] = referencePayload()
    expect(seance).toBeDefined()
    expect(Object.keys(seance!)).toEqual(['slug', 'name', 'exercises'])

    const [exercise] = seance!.exercises
    expect(exercise).toBeDefined()
    expect(Object.keys(exercise!)).toEqual([
      'slug',
      'name',
      'defaultReps',
      'defaultWeight',
      'weightUnit',
      'restSeconds',
      'isDumbbell',
      'sets',
    ])

    const [set] = exercise!.sets
    expect(set).toBeDefined()
    expect(Object.keys(set!)).toEqual(['id', 'reps', 'weight', 'completedAt', 'isWarmup'])
  })
})
