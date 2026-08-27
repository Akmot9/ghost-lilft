# AppApi — le contrat entre Vue et Rust

Statut : référence. Issue fondatrice : #66 (épic #73).

Ce document est la spécification unique de la frontière entre le frontend Vue
et le cœur Rust. Ses deux moitiés exécutables sont :

- `src/lib/appApi.ts` — types TypeScript, interface `AppApi`, adaptateurs
  (`appApiTauri.ts` pour l'app réelle, `appApiMemory.ts` pour les tests) ;
- `src-tauri/src/contract.rs` — DTO serde, invariants (`validate_seances`),
  format d'erreur (`AppError`).

Les deux moitiés sont cousues par des fixtures partagées (voir
[Fixtures contractuelles](#fixtures-contractuelles)). Quand ce document et le
code divergent, c'est un bug : corriger l'un ou l'autre, dans le même
changement.

## La doctrine de la frontière

**Rust est autoritaire.** Toute écriture passe (à terme) par une commande
Rust qui valide, exécute dans une vraie transaction SQLite, et rend soit le
nouvel état, soit une `AppError`. La validation des formulaires Vue est une
aide de saisie immédiate — elle peut être plus stricte, jamais plus laxiste,
et rien ne repose sur elle.

**Pinia est une projection.** Le store reflète ce que l'API a rendu ; il
n'invente ni identifiants ni slugs ni dates (#72 achève cette migration).

**Les adaptateurs sont substituables.** `AppApi` n'importe rien de Tauri.
L'app branche `createTauriAppApi()` ; les tests et le navigateur nu branchent
`createMemoryAppApi()`. Un consommateur ne sait pas auquel il parle.

## Les DTO canoniques

Trois formes, sérialisées en JSON camelCase, tous champs explicites (pas de
valeur par défaut sur le fil) :

```
Seance      { slug, name, isDemo, exercises: Exercise[] }
Exercise    { slug, name, defaultReps, defaultWeight, weightUnit,
              restSeconds, isDumbbell, sets: ExerciseSet[] }
ExerciseSet { id, reps, weight, completedAt, isWarmup }
```

L'ordre des clés ci-dessus est **normatif** : les fixtures se comparent octet
pour octet dans les deux langages.

L'ordre des tableaux est porteur de sens, il n'y a pas de champ `position`
sur le fil :

- `Seance.exercises` : l'ordre du programme, celui de l'écran et de la salle ;
- `Exercise.sets` : du plus récent au plus ancien, comme partout dans l'app.

Côté Rust, les DTO sont `deny_unknown_fields` : un champ ajouté d'un seul
côté fait échouer les tests contractuels au lieu d'être avalé en silence.

## Dates et journée d'entraînement

- `completedAt` voyage en **horodatage UTC canonique** :
  `AAAA-MM-JJTHH:MM:SS.mmmZ`, exactement ce que produit
  `Date.prototype.toISOString()` (24 caractères, millisecondes, suffixe `Z`).
- Toute autre écriture ISO 8601 — décalage `+02:00`, secondes sans
  millisecondes — est **refusée** (`date-invalide`), même si elle désigne un
  instant équivalent : la déduplication des séries se fait par signature
  textuelle `date|reps|poids`, deux écritures d'un même instant créeraient
  des doublons.
- La **journée d'entraînement** est le **jour UTC** de `completedAt`
  (`getDateKey` dans `trainingInsights.ts`). Choix assumé : simple, stable
  d'un appareil à l'autre, et une séance tardive à Paris (23 h, soit 21 h
  UTC) reste sur son jour. La limite connue — une séance entre minuit et
  2 h du matin heure de Paris compte sur la veille UTC — est acceptée ;
  en changer serait une migration de comportement, hors contrat.

## Invariants

Tenus par `validate_seances` (Rust). Première violation rencontrée, première
rendue.

| Donnée | Invariant | Code d'erreur |
| --- | --- | --- |
| slug (séance, exercice) | non vide ; `[a-z0-9]` et tirets simples, jamais en bord (la forme que produit `slugify`) | `slug-invalide` |
| slug de séance | unique dans la base | `slug-duplique` |
| slug d'exercice | unique dans sa séance (deux séances peuvent avoir `curl`) | `slug-duplique` |
| nom (séance, exercice) | non vide, sans espaces de bord | `nom-invalide` |
| `defaultReps`, `reps` | entier ≥ 1 | `repetitions-invalides` |
| `defaultWeight` | ≥ 0 (poids du corps admis), multiple de 0,5 kg | `charge-invalide` |
| `weight` (série) | ≥ 1 kg, multiple de 0,5 kg, fini | `charge-invalide` |
| `weightUnit` | non vide, sans espaces de bord | `unite-invalide` |
| `restSeconds` | entier ≥ 0 | `repos-invalide` |
| `id` (série) | entier ≥ 1 | `identifiant-invalide` |
| `id` (série) | unique sur **toute la base**, pas par exercice — la suppression se fait par identifiant seul | `identifiant-duplique` |
| `completedAt` | horodatage UTC canonique (ci-dessus), date réelle du calendrier | `date-invalide` |

Le demi-kilo est la plus petite marche du matériel : un total impair réparti
sur deux haltères (12,5 kg pièce), une marche de rampe à 32,5 kg. Les poids
sont des `f64` côté Rust et des `number` côté TypeScript ; sur le fil, un
poids entier s'écrit sans décimale (`60`, pas `60.0`).

## Format d'erreur

Toute commande échoue en `AppError` :

```json
{ "code": "date-invalide", "message": "Série 7 : « 2026-08-15 » n'est pas un horodatage UTC canonique (AAAA-MM-JJTHH:MM:SS.mmmZ)." }
```

- `code` : stable, en kebab-case français ; c'est à lui que le code s'accroche
  (tests, branchements d'interface). La liste vit dans `contract::codes` et
  dans `fixtures/contract-errors.json`.
- `message` : français, affichable tel quel par Vue, sans bruit technique
  (jamais un `Debug` brut).
- Côté TypeScript, `toAppError` normalise toute défaillance (chaîne rejetée
  par une commande pas encore migrée, exception du runtime) sous le code
  `erreur-inattendue`.

## Les commandes

### Existantes

| Commande | Entrée | Sortie | Erreurs |
| --- | --- | --- | --- |
| `db_file_name` | — | `string` : nom du fichier SQLite, décidé par le profil Rust (debug/release) | — |
| `import_seances` | `seances` : `Seance[]` **sans `isDemo`** (ce que l'utilisateur restaure lui appartient, Rust écrit `is_demo = 0`) | — ; remplacement intégral des trois tables dans une vraie transaction rusqlite | chaîne brute (historique) — migrera vers `AppError` avec #70 |

### À venir (formes fixées ici, implémentation dans les issues citées)

| Commande | Entrée | Sortie | Issue |
| --- | --- | --- | --- |
| `bootstrap_seances` | — | `Seance[]` : sème le programme de démonstration si la base est vide (transaction), puis rend tout l'état | #55 |
| `create_seance` | `name`, `exercises: CreateExerciseInput[]` | `Seance` (slugs et positions décidés par Rust) | #68 |
| `rename_seance` | `seanceSlug`, `name` | `Seance` | #68 |
| `add_exercise` | `seanceSlug`, `input: CreateExerciseInput` | `Exercise` | #68 |
| `move_exercise` | `seanceSlug`, `exerciseSlug`, `direction` | `Seance` (ou refus silencieux aux extrémités) | #68 |
| `set_exercise_dumbbell` | `seanceSlug`, `exerciseSlug`, `isDumbbell` | `Exercise` | #68 |
| `adopt_demo_seances` / `delete_demo_data` | — | `Seance[]` | #68 |
| `add_set` | `seanceSlug`, `exerciseSlug`, `reps`, `weight`, `completedAt`, `isWarmup` | `ExerciseSet` (identifiant décidé par Rust) | #69 |
| `set_set_warmup` / `remove_set` / `clear_sets` | identifiants concernés | état mis à jour | #69 |
| `merge_sets` | `seanceSlug`, `exerciseSlug`, `sets` | `{ ajoutees, ignorees }` (déduplication par signature) | #69 |
| `export_backup` / `import_backup` | texte de sauvegarde | validation et écriture côté Rust | #70 |

`CreateExerciseInput` : `{ name, defaultReps, defaultWeight, weightUnit,
restSeconds?, isDumbbell? }` — la seule forme du contrat où des champs sont
optionnels, car Rust y applique les défauts (`180`, `false`) et rend toujours
la forme canonique complète.

## Fixtures contractuelles

Deux fichiers, générés par TypeScript, relus par Rust :

- `fixtures/contract-seances.json` — un lot de séances portant toutes les
  formes du contrat (démo, haltères, demi-kilo, échauffement, exercice sans
  série) ;
- `fixtures/contract-errors.json` — un exemple de chaque code d'erreur.

Le mécanisme (hérité de `fixtures/import-payload.json`) :

1. `src/lib/__tests__/appApi.spec.ts` produit les fixtures avec les vraies
   fonctions du contrat et les compare octet pour octet aux fichiers ;
2. les tests de `src-tauri/src/contract.rs` désérialisent **les mêmes
   fichiers**, les passent à `validate_seances`, les resérialisent, et
   exigent de retomber octet pour octet sur les mêmes fichiers.

Un champ renommé, réordonné ou retypé d'un seul côté fait tomber au moins un
des deux tests. Changement volontaire (des deux côtés) :

```sh
GHOST_LIFT_UPDATE_FIXTURES=1 npm run test:unit
```

puis relire le diff : c'est exactement ce qui circulera entre Vue et Rust.
