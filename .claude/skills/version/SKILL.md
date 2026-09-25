---
name: version
description: Use when the user asks to prepare, bump, cut or release a version of Revenant, or to send a build to TestFlight (« prépare la version 1.14.0 », « on sort une version », « envoie sur TestFlight »).
---

# Préparer une version

Une version de Revenant est **un commit sur `main`** qui ne touche qu'une
ligne, puis **un tag** qui déclenche un vrai envoi à Apple. Le commit est à
toi ; le tag ne l'est jamais sans un oui explicite.

## Avant de toucher au fichier

Arrête-toi et dis pourquoi si l'un de ces points échoue.

1. `git fetch origin --tags`, puis : branche `main`, arbre propre, ni en
   avance ni en retard sur `origin/main`.
2. Le tag n'existe nulle part : `git tag -l 'ios-vX.Y.Z'` et
   `git ls-remote --tags origin 'ios-vX.Y.Z'` ne rendent rien.
3. Les trois suites de la CI passent en local :
   `npm run type-check && npm run test:unit`, `npm run test:e2e`,
   `cargo test --manifest-path src-tauri/Cargo.toml`.
   Un test rouge bloque la version, qu'il date de ce matin ou d'il y a un
   mois : on ne livre pas sur une suite rouge. S'il échouait déjà avant, dis-le
   en le nommant, c'est une information pour qui le répare, pas une excuse
   pour passer.
4. Le parcours de bureau, qui ne tourne pas en CI et existe pour ce moment :
   `npm run test:e2e:desktop`. S'il ne peut pas tourner (paquets système
   absents), dis-le, ne le passe pas sous silence.
5. `git log --oneline ios-v<précédente>..HEAD` : ce que la version contient.
   Rien de visible pour l'utilisateur de l'app depuis le dernier tag ? Dis-le
   avant de continuer.

## Le changement

`src-tauri/tauri.conf.json`, champ `"version"`. Rien d'autre : `package.json`
reste à `0.0.0` et `Cargo.toml` à `0.1.0`, ils ne suivent pas la version.

## Le commit

Titre : `Prépare la version X.Y.Z`.

Le corps est **la note de version, écrite pour le lifteur** : un paragraphe
de trois à six phrases qui dit ce qui change pour lui à la salle, au présent,
sans jargon. Il part de ce que l'utilisateur voit, pas de ce que le code a
fait.

> Une sauvegarde emporte enfin le poids de corps. Jusqu'ici, réinstaller
> l'app et restaurer un export rendait le programme et tout l'historique de
> séries — et aucune pesée : elles ne quittaient jamais l'appareil.

Le corps contient donc ce que l'app fait de nouveau, ce qui se comporte
autrement, et ce qu'une ancienne donnée devient. Les numéros d'issue, les
noms de fichiers, les tests, la CI, Grafana et l'outillage vivent dans les
commits qui les ont livrés.

## Ensuite

Montre le commit et la note, puis **demande** avant chacun de ces gestes :

- `git push origin main`
- `git tag ios-vX.Y.Z && git push origin ios-vX.Y.Z` : le tag lance
  `.github/workflows/ios-testflight.yml`, qui construit l'IPA et l'envoie à
  TestFlight. C'est irréversible côté Apple : un numéro de build consommé ne
  se réutilise pas.

Après le tag, suis le workflow avec `gh run watch` et rends le résultat.
Le numéro de build Apple est celui du run, sauf demande contraire.
