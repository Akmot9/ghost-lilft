# Tableau de bord Grafana pour tes exports Revenant

Un Grafana local, lancé par `docker compose`, qui lit les sauvegardes
exportées depuis l'app (`revenant-AAAA-MM-JJ.json`) et en tire volume,
régularité, charges max, 1RM estimé et records par exercice.

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
  v1 et v2), prend le programme (séances, exercices, noms) de la plus
  récente et **réunit** les séries de toutes, dédoublonnées par signature
  `séance | exercice | date | reps | charge` — la même règle que l'app à
  l'import. Tu peux donc garder tous tes exports dans `exports/`, ou n'en
  déposer qu'un seul.
- La base a quatre tables (`exports`, `seances`, `exercises`, `sets`) et une
  vue `working_sets` (séries hors échauffement) : c'est elle que les
  panneaux interrogent, l'échauffement ne compte ni dans le volume ni dans
  les records, comme dans l'app. La journée d'entraînement est le jour UTC
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
| Séries de travail par semaine | régularité : séries et journées par semaine |
| Charge max par journée | par exercice, la série la plus lourde de chaque journée |
| 1RM estimé (Epley) | charge × (1 + reps ÷ 30) — une estimation, pas un record |
| Records par exercice | charge max, meilleur 1RM estimé, journées, séries, volume, dernière fois |
| Répartition du volume | la part de chaque exercice |
| Toutes les séries | le détail, échauffements compris, filtrable |

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
```
