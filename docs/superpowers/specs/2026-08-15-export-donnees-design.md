# Export et restauration des données de séance

*Design validé le 15 août 2026. Couvre l'issue #45.*

## Problème

Tout est en SQLite local sur l'appareil. Un changement d'iPhone, une
réinstallation ou l'expiration d'un build TestFlight — 90 jours — fait
disparaître l'historique complet, sans recours. L'app ne sait écrire aucun
fichier aujourd'hui : ni plugin `fs`, ni plugin `dialog` dans
`src-tauri/capabilities`.

## Périmètre

**Dans le périmètre**

- Export de la totalité des données vers un fichier JSON choisi par l'utilisateur.
- Import de ce fichier, **uniquement tant que l'utilisateur n'a aucune donnée réelle**.
- Fonctionnement sur iOS et en mode navigateur (dev et tests e2e).

**Hors périmètre**

- Toute forme de fusion entre une sauvegarde et des données existantes.
- Le partage d'un modèle de séance seul. Le format le prévoit, la feature non.
- La capture du graphe de progression, qui est l'issue #35 / GL-12 — un besoin
  distinct, image et non données.
- Toute synchronisation automatique ou cloud.

## Format du fichier

Nom proposé à l'export : `ghost-lift-AAAA-MM-JJ.json`.

```json
{
  "format": "ghost-lift-backup",
  "version": 1,
  "exportedAt": "2026-08-15T14:00:00.000Z",

  "seances": [
    {
      "slug": "upper-a",
      "name": "Upper A",
      "exercises": [
        {
          "slug": "developpe-couche",
          "name": "Développé couché",
          "defaultReps": 8,
          "defaultWeight": 70,
          "weightUnit": "kg",
          "restSeconds": 120
        }
      ]
    }
  ],

  "history": [
    {
      "seanceSlug": "upper-a",
      "exerciseSlug": "developpe-couche",
      "sets": [
        { "reps": 8, "weight": 70, "completedAt": "2026-08-01T18:20:00.000Z" }
      ]
    }
  ]
}
```

### Décisions de format

**Le modèle de séance est séparé de l'historique.** `seances` décrit la
structure — nom, exercices, valeurs par défaut, repos prescrit — et `history`
porte les séries. Les séances devant devenir partageables indépendamment des
données, la couture est posée maintenant : elle ne coûte que la forme du JSON.

**`history` est optionnel.** Un fichier sans `history` est un programme
d'entraînement : mêmes séances, historique vide à l'import. Le futur partage de
séance sera une case « sans mon historique » à l'export, sans nouveau format ni
nouvelle version.

**Les identifiants de séries ne sont pas exportés.** Ce sont des autoincrement
locaux, réattribués à l'import. Les exporter promettrait une stabilité que rien
ne garantit d'un appareil à l'autre.

**`isDemo` n'est pas exporté.** Une sauvegarde restaurée est par définition la
donnée de l'utilisateur ; elle ne doit pas ressusciter la bannière du mode
découverte par-dessus.

**Exporter depuis le mode découverte exporte le programme d'exemple.** Aucune
raison de l'interdire, mais la conséquence doit être assumée : `isDemo` n'étant
pas exporté, un tel fichier restitue le programme d'exemple comme des données
réelles, sans bannière.

**`format` et `version` sont obligatoires.** Ils permettent de refuser un
fichier étranger avec un message clair plutôt que d'échouer en cours de route.

## Règles d'import

**L'import n'est possible que lorsque l'utilisateur n'a aucune donnée réelle**,
c'est-à-dire `seances.every((seance) => seance.isDemo)` — aucune séance, ou
uniquement le programme d'exemple. Cette condition supprime par construction
toute question de fusion : il n'y a jamais rien à arbitrer.

Le mode découverte impose cette formulation. Au premier lancement la base n'est
pas vide : elle contient le programme d'exemple, jetable par construction. La
condition n'est donc pas « base vide » mais « rien à perdre ».

Un import remplace les données d'exemple par le contenu du fichier, **dans une
seule transaction SQL**. Un import interrompu à mi-parcours ne doit pas laisser
une base à moitié peuplée.

Une fois la première séance réelle créée, le point d'entrée disparaît de
l'interface, et le store refuse l'appel s'il est atteint autrement.

## Interface

**Exporter** — bouton en bas de `SeanceSelectView`, toujours disponible.

**Restaurer une sauvegarde** — visible seulement tant qu'il n'y a pas de donnée
réelle, à deux endroits :

- sur l'écran d'onboarding, à côté de la création de séance ;
- dans la bannière Mode découverte, en troisième action après « adopter » et
  « supprimer ».

Les confirmations se font en deux clics sur le même bouton, comme
`deleteDemoData` et `clearSets`. `window.confirm` est muet dans le WebView iOS
(GL-25) et ne doit pas être utilisé.

Pas d'écran de réglages : l'app n'en a pas, et en créer un pour deux boutons
ajouterait une surface à maintenir sans rien apporter.

## Découpage du code

| Unité | Rôle | Dépendances |
|---|---|---|
| `src/lib/backup.ts` | `serializeBackup(seances)` et `parseBackup(text)` — pur, lève sur fichier invalide | aucune |
| `src/lib/fileTransfer.ts` | seule unité qui connaît `dialog` et `fs` | Tauri |
| `src/stores/seances.ts` | `exportBackup()` et `importBackup()` — la partie qui touche la base | SQL |

`backup.ts` ne dépend ni de Tauri ni du store : c'est là que vit toute la
logique de validation, et elle se teste sans mock.

## Comportement hors Tauri

`fileTransfer` dégrade en mode navigateur : téléchargement via `Blob` à
l'export, `<input type="file">` à l'import. Ce n'est pas une commodité de
développement — c'est ce qui rend la feature vérifiable en e2e, donc en CI.

## Erreurs et cas limites

Chaque cas produit un message lisible dans l'interface, jamais un échec
silencieux ni une base partiellement modifiée.

| Cas | Comportement |
|---|---|
| L'utilisateur annule le dialogue de fichier | Aucune action, aucun message |
| Le fichier n'est pas du JSON | Refus : « fichier illisible » |
| `format` absent ou différent de `ghost-lift-backup` | Refus : ce n'est pas une sauvegarde Ghost Lift |
| `version` supérieure à 1 | Refus : sauvegarde créée par une version plus récente de l'app |
| Champ obligatoire manquant ou mal typé | Refus, sans modification de la base |
| `history` référence une séance ou un exercice absent de `seances` | Refus : fichier incohérent |
| Slugs dupliqués dans une même séance | Refus |
| `completedAt` non parsable en date | Refus |
| Import appelé alors que des données réelles existent | Le store lève ; le bouton n'est déjà plus affiché |

## Tests

**Unitaires (`src/lib/__tests__/backup.spec.ts`)**

- Aller-retour `serializeBackup` → `parseBackup` sans perte, en s'appuyant sur
  les scénarios de `src/datasets/scenarios.ts`.
- Un fichier sans `history` produit des séances à l'historique vide.
- Un cas de refus par ligne du tableau ci-dessus.

**Store**

- `importBackup` refuse quand une séance non-démo existe.
- Un import échouant en cours de route laisse la base inchangée.

**e2e**

Le parcours réel, du scénario `progression` : exporter, repartir d'une base en
mode découverte, restaurer, vérifier que les séries et le graphe sont revenus.
C'est le seul test qui prouve que la sauvegarde protège vraiment — le reste ne
teste que du JSON.

## Impacts sur le build iOS

- `tauri-plugin-dialog` et `tauri-plugin-fs`, côté Cargo et côté npm.
- Permissions correspondantes, scopées, dans `src-tauri/capabilities`.
- Un fichier `PrivacyInfo.xcprivacy` déclarant la raison d'usage des API
  fichiers. Apple l'exige ; son absence vaut un rejet à la soumission suivante.
- Le projet iOS doit être régénéré.

**À ne pas livrer tant que la soumission App Store en cours n'est pas tranchée**
(#48) : ces changements modifient le binaire.
