# La matrice de tests de Revenant

Le cœur métier vit en Rust, l'écran en Vue (`docs/app-api.md`). Quatre niveaux
de tests couvrent cette frontière, chacun avec une responsabilité qui lui est
propre — et **aucune** qui se recouvre. Un test placé au mauvais niveau coûte
le double : il est lent là où il pourrait être rapide, ou aveugle là où il se
croit couvrant.

| Niveau | Ce qu'il prouve | Où | Commande |
| --- | --- | --- | --- |
| Domaine Rust | Les règles et les validations, sans base ni fenêtre | `src-tauri/src/*.rs`, `mod tests` | `cargo test --manifest-path src-tauri/Cargo.toml` |
| SQLite réel | Les transactions : écriture, échec, rollback, fermeture, réouverture | mêmes modules, sur `tempfile::NamedTempFile` | idem |
| Contrat IPC | Les noms de commandes, les champs et les types, des deux côtés du pont | `src-tauri/src/lib.rs` (`invoking_*_by_name`), `src/stores/__tests__/seancesTauriIpc.spec.ts`, `fixtures/*.json` | `cargo test` **et** `npm run test:unit` |
| Présentation | Ce qu'un écran affiche et ce qu'il appelle | `src/**/__tests__/*.spec.ts` (Vitest + `@vue/test-utils`) | `npm run test:unit` |
| Parcours | Que les écrans s'enchaînent dans un vrai navigateur | `e2e/*.spec.ts` (Playwright, Chromium) | `npm run test:e2e` |

La CI (`.github/workflows/ci.yml`) exécute les cinq : type-check et Vitest,
Playwright, et `cargo test`.

## Les règles qui rendent ces niveaux honnêtes

**Une règle métier se teste en Rust, une seule fois.** Si une règle est
vérifiée en TypeScript *et* en Rust, la version TypeScript finira par diverger
en silence : c'est le risque que l'epic #73 nomme — « un faux backend
navigateur qui deviendrait par accident une seconde implémentation métier ».
Les deux copies TypeScript qui existent — le codec de sauvegarde
(`src/lib/backup.ts`, #70) et les règles d'entraînement
(`src/lib/insightsBrowser.ts`, #71) — sont des **adaptateurs navigateur**,
jamais production, et chacune est verrouillée sur Rust par une fixture
partagée : `fixtures/contract-backup.json` octet pour octet,
`fixtures/insights-cases.json` instantané par instantané. Le test TypeScript
écrit le fichier, le test Rust le relit et doit rendre la même chose.

**Une transaction se teste sur un fichier, jamais en mémoire.** Une base
`:memory:` ne prouve pas qu'un rollback a survécu à la fermeture. Les tests
transactionnels ouvrent un `NamedTempFile`, le referment, le rouvrent et
relisent.

**Le pont IPC se teste des deux côtés, sur des fixtures partagées.**
`fixtures/contract-seances.json` et `fixtures/contract-errors.json` sont
désérialisés par Rust *et* par TypeScript : un champ ajouté d'un seul côté
casse un test au lieu de casser l'app. `invoke('import_seance')` au singulier
compilerait et passerait les tests unitaires du store — c'est
`seancesTauriIpc.spec.ts`, qui fait tourner la vraie branche Tauri derrière
`mockIPC`, qui l'attrape.

**Un test de présentation utilise un faux strict.**
`createStrictAppApi` (`src/lib/appApiStrict.ts`) ne répond qu'à ce que le test
lui apprend et **jette sur tout appel inattendu**, en le nommant. C'est ce qui
permet de prouver qu'un écran appelle la bonne commande — et seulement elle.
`useAppApiForTests` l'injecte dans le store et rend de quoi le retirer.

`createMemoryAppApi` (`src/lib/appApiMemory.ts`) est l'autre faux : un backend
complet, qui répond à tout. Il sert aux scénarios de bout en bout et au mode
navigateur ; il ne sert **pas** à prouver qu'un écran appelle la bonne
commande, puisqu'il répondrait aussi à la mauvaise.

**Pinia ne change qu'après un succès.** `seancesRejection.spec.ts` le vérifie
sur le faux strict : une commande rejetée laisse l'écran exactement dans
l'état où il était. Un store qui écrirait son cache avant l'aller-retour
échoue là.

**Les parcours e2e ne rejouent pas le métier.** Ils vérifient qu'on peut aller
d'un écran à l'autre et que ce qui s'affiche vient bien du store. Les règles
elles-mêmes sont déjà prouvées en Rust : les redire en Playwright coûterait
des minutes de CI pour une couverture qu'on a déjà.
