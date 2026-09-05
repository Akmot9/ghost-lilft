# Tableau de bord Grafana pour tes exports Revenant

Un Grafana local, lancé par `docker compose`, qui lit les sauvegardes
exportées depuis l'app (`revenant-AAAA-MM-JJ.json`) et en tire volume,
régularité, charges max, 1RM estimé, effort perçu (RPE), poids de corps et
records par exercice.

## Lancer

```sh
cd grafana
cp ~/Downloads/revenant-2026-08-28.json exports/   # une ou plusieurs sauvegardes
docker compose up
```

Puis http://localhost:3000 — le tableau de bord « Revenant » est la page
d'accueil, sans connexion. Si le port est pris :

```sh
REVENANT_GRAFANA_PORT=3300 docker compose up
```

Après un nouvel export, dépose-le dans `exports/` et relance
`docker compose up` : la base est reconstruite à chaque démarrage.

## Comment ça marche

```
exports/*.json  ──chargeur (python:3-alpine)──▶  data/revenant.db  ──▶  Grafana
                   import_exports.py               SQLite                 plugin frser-sqlite-datasource
```

- `import_exports.py` lit toutes les sauvegardes (format `ghost-lift-backup`
  v1 à v4), prend le programme (séances, exercices, noms) de la plus
  récente et **réunit** les séries de toutes, dédoublonnées par signature
  `séance | exercice | date | reps | charge` — la même règle que l'app à
  l'import. Tu peux donc garder tous tes exports dans `exports/`, ou n'en
  déposer qu'un seul. Le RPE (v3) suit la série : la signature de
  dédoublonnage l'ignore, donc une sauvegarde plus récente **complète** la
  note d'une série déjà importée sans elle — sans jamais écraser une note
  déjà là. Les pesées (v4) suivent la règle inverse : un même jour peut
  légitimement porter deux poids dans deux exports, alors la **lecture la plus
  récente l'emporte**, comme quand on repèse le même jour dans l'app.
- La base a cinq tables (`exports`, `seances`, `exercises`, `sets`,
  `body_weights`) et une vue `working_sets` (séries hors échauffement) : c'est elle que les
  panneaux interrogent, l'échauffement ne compte ni dans le volume ni dans
  les records, comme dans l'app. `sets.rpe` vaut `NULL` quand la série n'est
  pas notée : une série sans note n'est pas une série facile, elle ne pèse
  sur aucune moyenne. Une semaine sans séance, en revanche, compte bien pour
  zéro dans les moyennes hebdomadaires : ne pas s'entraîner est un fait, pas
  une donnée manquante. Le jour d'une pesée est celui du **pèse-personne** —
  le jour *local*, quand les séries sont datées en UTC ; `body_weights.day_ts`
  le pose à minuit UTC, sans inventer de fuseau. Les deux ne se comparent
  qu'à l'échelle où un décalage d'un jour ne change rien (tendance, moyenne).
  La journée d'entraînement est le jour UTC
  de la série, comme dans l'app ; les semaines commencent le lundi.
- `provisioning/` déclare la source de données et charge
  `dashboards/revenant.json`. Le tableau de bord est modifiable dans
  l'interface ; pour garder une retouche, exporte le JSON (Partager →
  Exporter) et remplace le fichier.

`exports/` et `data/` sont ignorés par git : ce sont tes données.

## Ce que montre le tableau de bord

Filtres en haut : période (90 derniers jours par défaut), séance, exercice.

| Panneau | Ce qu'il mesure |
| --- | --- |
| Journées d'entraînement, Séries de travail, Volume soulevé, Charge max, Dernière série | les chiffres clés de la période |
| Volume par journée, par séance | reps × charge, empilé par séance |
| Volume par semaine, Volume hebdo moyen | le volume de travail hebdomadaire et quatre moyennes : glissantes sur **1, 3 et 5 semaines**, plus celle depuis la première semaine entraînée de la période. Plus la fenêtre est large, plus la courbe est lisse — la courte suit la séance, la longue suit la saison. **Une semaine sans séance compte pour zéro** et les fait descendre ; les semaines d'avant la première séance n'existent pas. Le bloc « Volume hebdo moyen » est le dernier point de la moyenne depuis le début. |
| Séries de travail par semaine | régularité : séries et journées par semaine |
| Charge max par journée | par exercice, la série la plus lourde de chaque journée |
| 1RM estimé (Epley) | charge × (1 + reps ÷ 30) — une estimation, pas un record |
| Records par exercice | charge max, meilleur 1RM estimé, journées, séries, volume, dernière fois |
| RPE moyen, Séries notées, Part notée | l'effort perçu sur les séries de travail notées |
| RPE moyen par journée | à charge égale, une courbe qui descend dit que la charge est devenue légère |
| Effort par exercice | RPE moyen et max, charge notée, dernière note — seuls les exercices notés |
| Poids actuel, Écart sur la période, Pesées | la dernière pesée, ce qu'elle a bougé, combien de jours pesés |
| Poids de corps | chaque pesée et sa moyenne sur 7 jours glissants — c'est elle qui dit la tendance |
| Volume rapporté au poids de corps | combien de fois ton propre poids tu as soulevé, par journée : progresser à poids stable, ou seulement peser plus lourd |
| Répartition du volume | la part de chaque exercice |
| Toutes les séries | le détail, RPE et échauffements compris, filtrable |

## Écrire ses propres requêtes

Dans Explore (source « Revenant »), du SQLite ordinaire. Les colonnes de
temps sont en secondes Unix (`completed_ts`, `day_ts`, `week_ts`) ; pour la
période du sélecteur, filtrer sur `completed_ts BETWEEN $__from / 1000 AND
$__to / 1000`.

```sql
-- charge max de chaque journée au squat
SELECT day_ts AS time, MAX(weight) AS charge
FROM working_sets
WHERE exercise_slug = 'high-bar-squat'
GROUP BY day_ts ORDER BY day_ts

-- les séries les plus dures : où la charge coûte le plus
SELECT day, exercise_slug, reps, weight, rpe
FROM working_sets
WHERE rpe >= 9 ORDER BY completed_ts DESC

-- le poids de corps au jour de chaque séance
SELECT s.day, MAX(s.weight) AS charge,
       (SELECT b.kilograms FROM body_weights b
         WHERE b.day <= s.day ORDER BY b.day DESC LIMIT 1) AS poids
FROM working_sets s GROUP BY s.day ORDER BY s.day
```

## Tests

L'import a ses tests, bibliothèque standard seule comme lui :

```sh
cd grafana && python3 -m unittest test_import_exports
```

Ils ne tournent pas dans la CI, qui ne monte pas de Python.
