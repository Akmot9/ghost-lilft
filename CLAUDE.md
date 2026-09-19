# Revenant (dépôt `ghost-lift`)

App de suivi de musculation pour un lifteur autonome, utilisée sur mobile entre
les séries. Vue 3 + Pinia + TypeScript pour l'écran, Tauri 2 en Rust avec SQLite
embarqué pour le métier, cible iOS comprise. À côté, `grafana/` : une pile
Python + Docker qui lit les exports de l'app.

Tout s'écrit en **français** : interface, commentaires, messages de commit,
noms de tests. Seuls les identifiants du code restent en anglais.

## La règle qui commande le reste

**Le métier vit en Rust, une seule fois.** Règles d'entraînement, validations,
format de sauvegarde, schéma SQL : tout est dans `src-tauri/src/`. Le frontend
affiche et appelle, il ne décide pas.

Deux fichiers TypeScript recopient du métier, `src/lib/backup.ts` et
`src/lib/insightsBrowser.ts`. Ce sont des **adaptateurs navigateur**, jamais
la production, et chacun est verrouillé sur Rust par une fixture partagée de
`fixtures/`. Changer une règle, c'est la changer en Rust, puis dans
l'adaptateur, puis régénérer la fixture ; un seul des trois ne passe pas les
tests.

Avant de toucher à la frontière Vue ↔ Rust, lis `docs/app-api.md`. Avant
d'écrire un test, lis `docs/tests.md` : il dit à quel niveau le test
appartient, et un test au mauvais niveau coûte double.

## Commandes

```sh
npm run dev                  # l'app dans le navigateur, backend en mémoire
npm run tauri:dev            # l'app de bureau, vrai backend Rust
npm run type-check           # vue-tsc
npm run test:unit            # Vitest
npm run test:e2e             # Playwright, Chromium
npm run test:e2e:desktop     # parcours de bureau, hors CI, avant une release
cargo test --manifest-path src-tauri/Cargo.toml
cd grafana && python3 -m unittest test_import_exports   # hors CI
```

La CI (`.github/workflows/ci.yml`) lance type-check, Vitest, Playwright et
`cargo test`. Elle ne lance ni le parcours de bureau ni les tests Python.

## Où va un test

| Ce que tu prouves | Où |
| --- | --- |
| Une règle, une validation | Rust, `mod tests` du module |
| Une transaction | Rust, sur un `NamedTempFile`, jamais `:memory:` |
| Un nom de commande, un champ du pont IPC | des deux côtés, sur `fixtures/contract-*.json` |
| Ce qu'un écran affiche et appelle | Vitest, avec `createStrictAppApi` |
| L'enchaînement des écrans | Playwright, sans rejouer le métier |

`createMemoryAppApi` répond à tout : il sert aux scénarios, pas à prouver
qu'un écran appelle la bonne commande.

## Conventions

- **Commits** : une phrase au présent, troisième personne, qui dit ce que le
  commit fait et non ce que l'auteur a fait, suivie de l'issue entre
  parenthèses quand il y en a une. « Porte les règles d'entraînement en Rust,
  prouvées à l'identique (#71) ». Le corps explique le pourquoi.
- **Version** : un commit « Prépare la version X.Y.Z » qui ne touche que
  `src-tauri/tauri.conf.json`. Le build TestFlight part d'un tag `ios-v*`.
- **Commentaires** : ils expliquent une décision, pas une ligne. Le code
  existant en donne le ton.
- **Rust** : indentation à deux espaces (`src-tauri/rustfmt.toml`). Le backend
  n'est pas encore entièrement au format : ne lance pas `cargo fmt` sur un
  fichier entier au détour d'un changement fonctionnel.
- **Couleurs** : palette « nuit & laiton », dans `COLORS.md`. Pas de couleur
  en dur hors de cette palette.
- **Priorité** : fermer des issues plutôt qu'en ouvrir. Les epics ouverts sont
  #95 (coach et médecin du sport) et #48 (App Store iOS).

## Ne pas modifier à la main

`package-lock.json`, `Cargo.lock`, `deno.lock` et `src-tauri/gen/` : ils ne
changent que par leurs outils. Un hook le refuse.

## Données personnelles

Ignorées par git, à ne jamais commiter : les exports `revenant-*.json` à la
racine, `grafana/exports/`, `grafana/nutrition/`, `grafana/garmin/`,
`grafana/data/`. Le détail de la pile Grafana est dans `grafana/README.md`.

## Outillage Claude Code du dépôt

- `.claude/hooks/` : refus des fichiers générés avant édition ; après
  édition, tests Vitest liés au fichier TypeScript touché, et tests du
  chargeur quand on touche à `grafana/*.py`.
- `.claude/skills/releve` : mettre à jour la base Grafana.
- `.claude/skills/version` : préparer une version.
- `.claude/agents/gardien-du-contrat` : vérifier qu'un changement de règle a
  bien suivi des deux côtés du pont.
