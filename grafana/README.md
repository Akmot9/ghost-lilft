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

### Le journal des repas

L'app ne connaît pas la nutrition. Si tu veux la voir à côté du poids de
corps et du volume, tiens `nutrition/repas.csv` à la main, une ligne par
aliment, macros facultatives (laisse la case vide quand tu ne les connais
pas — un plat de restaurant sans étiquette n'a pas zéro protéine) :

```csv
date,heure,repas,aliment,kcal,proteines,lipides,glucides
2026-09-19,13:00,midi,Magret de canard (500 g),1150,95,85,0
2026-09-19,20:30,soir,Un truc au resto,900,,,
```

`repas` vaut `matin`, `midi`, `soir` ou `collation`. Le chargeur refuse une
ligne illisible en disant laquelle. Sans fichier, la table reste vide.

### Le journal MyFitnessPal

Si tu saisis dans MyFitnessPal (base d'aliments, scan de codes-barres),
`mfp_sync.py` tire ton journal dans `nutrition/mfp.csv`, au même format :

```sh
python3 mfp_sync.py          # --jours 120 par défaut
docker compose up -d
```

Il passe par le serveur MCP `mfp-mcp` (`pipx install mfp-mcp`, puis
`mfp-mcp auth` **dans une autre fenêtre de terminal** — le cookie de session
ne doit pas entrer dans une conversation). La session dure environ 30 jours ;
passé ce délai, le script dit que la session a expiré et il faut refaire
`mfp-mcp auth`.

**Les deux journaux remplissent la même table.** Chaque ligne garde le sien
dans `meals.source` (`manuel` ou `myfitnesspal`). Un même jour tenu dans les
deux fait **échouer le chargeur**, en nommant le jour : additionner
doublerait les calories, choisir un gagnant effacerait l'autre en silence.
Garde donc chaque journée dans un seul journal — en pratique, tout ce qui est
saisi dans MyFitnessPal n'a plus rien à faire dans `repas.csv`.

Le script ne relit que les `--jours` derniers jours, mais **garde** ce que le
CSV disait des journées hors fenêtre : une fenêtre plus courte ne perd pas
l'histoire déjà tirée.

### Les pesées de la balance Garmin

Si tu te pèses sur une balance Garmin, `garmin_sync.py` tire tout
l'historique de Garmin Connect dans `garmin/poids.csv`, que le chargeur verse
dans la table `garmin_weights` au démarrage suivant. À relancer de temps en
temps, le fichier est réécrit en entier :

```sh
~/.local/share/pipx/venvs/garmin-mcp/bin/python garmin_sync.py
docker compose up -d
```

Il s'appuie sur la bibliothèque et les jetons du serveur MCP Garmin
(`pipx install git+https://github.com/Taxuspt/garmin_mcp`, puis
`garmin-mcp-auth` une fois pour poser les jetons dans `~/.garminconnect`).
Les pesées Garmin ont leur propre table : le même jour, la balance et l'app
peuvent dire deux poids différents, et aucune des deux n'a tort — le panneau
« Poids de corps » les superpose.

### Le cardio de la montre Garmin

L'app connaît la fonte, série par série ; elle ne saura jamais que tu as
couru. `garmin_cardio_sync.py` tire tout l'historique d'activités de Garmin
Connect dans `garmin/cardio.csv`, que le chargeur verse dans la table
`garmin_activities`. Mêmes jetons, même principe que les pesées : le fichier
est réécrit en entier à chaque passage.

```sh
~/.local/share/pipx/venvs/garmin-mcp/bin/python garmin_cardio_sync.py
docker compose up -d
```

**Ce qui entre : tout sauf la fonte et les conteneurs multi-sport.** Reprendre
`strength_training` compterait l'entraînement deux fois, et Garmin n'en
connaît ni les reps ni la charge. Une activité multi-sport est un parent dont
Garmin rend aussi les segments : la garder doublerait la sortie. Le reste
passe avec son `sport` — course, tapis, trail, vélo, marche, rando, ski —,
sans liste blanche à tenir à jour.

La clé est l'identifiant Garmin, pas le jour : deux sorties le même jour
arrivent, et rien ne les distinguerait autrement. Ce que la montre n'a pas
mesuré vaut `NULL`, jamais 0 — un tapis sans ceinture ne fait pas une FC
nulle, il ne fait pas de FC. L'allure n'est pas stockée : elle se dérive de
`duration_s / distance_m`.

## Comment ça marche

```
exports/*.json      ──chargeur (python:3-alpine)──▶  data/revenant.db  ──▶  Grafana
nutrition/repas.csv    import_exports.py               SQLite                 plugin frser-sqlite-datasource
nutrition/mfp.csv ◀── mfp_sync.py           ◀── MyFitnessPal
garmin/poids.csv  ◀── garmin_sync.py        ◀── Garmin Connect (balance)
garmin/cardio.csv ◀── garmin_cardio_sync.py ◀── Garmin Connect (montre)
```

- `import_exports.py` lit toutes les sauvegardes (format `ghost-lift-backup`
  v1 à v6), prend le programme (séances, exercices, noms) de la plus
  récente et **réunit** les séries de toutes, dédoublonnées par signature
  `séance | exercice | date | reps | charge` — la même règle que l'app à
  l'import. Tu peux donc garder tous tes exports dans `exports/`, ou n'en
  déposer qu'un seul. Le RPE (v3) suit la série : la signature de
  dédoublonnage l'ignore, donc une sauvegarde plus récente **complète** la
  note d'une série déjà importée sans elle — sans jamais écraser une note
  déjà là. Les pesées (v4) suivent la règle inverse : un même jour peut
  légitimement porter deux poids dans deux exports, alors la **lecture la plus
  récente l'emporte**, comme quand on repèse le même jour dans l'app. La
  **décharge** (v5) suit la même règle que la pesée : marquer ou démarquer
  une séance est une décision, et l'export le plus récent porte la dernière ;
  une sauvegarde d'avant la v5 ne défait rien, elle ne connaît pas le drapeau.
- La base a huit tables (`exports`, `seances`, `exercises`, `sets`,
  `body_weights`, `meals` — dont `source`, le journal d'où vient la ligne —,
  `garmin_weights` — jour, kilos, masse grasse en %, masse musculaire en kg —
  et `garmin_activities` — une ligne par sortie de la montre : sport, distance,
  durée, FC, dénivelé, calories, et le lundi de sa semaine, le même que celui
  des séries)
  et cinq vues : `working_sets` (séries hors échauffement),
  `performance_sets` (hors échauffement **et** hors décharge : les records, le
  1RM estimé et la stagnation se lisent là — une semaine allégée ne bat rien),
  `exercise_days` (une journée d'un exercice : charge max, total de
  répétitions, RPE moyen, décharge ou non — la matière de l'alerte de
  stagnation) et
  `rests_taken` (le repos réellement pris entre deux séries de travail d'une
  même journée, mesuré sur les horodatages — une ligne par intervalle, la
  première série d'une journée n'en ayant pas, et au-delà de 15 min l'écart
  compte comme une interruption, pas comme un repos) et `nutrition_days` (les
  totaux du jour de `meals` : calories, macros, nombre d'aliments — une macro
  laissée vide sur un aliment ne compte pas, le total du jour est alors une
  borne basse). C'est `working_sets` que les
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

`exports/`, `nutrition/`, `garmin/` et `data/` sont ignorés par git : ce sont tes données.

## Ce que montre le tableau de bord

Filtres en haut : période (six dernières semaines par défaut), séance,
exercice, et l'objectif calorique qui trace la ligne du panneau « Calories
par jour ».

Les trois panneaux hebdomadaires — « Volume par semaine », « Volume
hebdomadaire glissant », « Séries par semaine » — **ignorent la période** et
montrent toujours un an : six semaines de barres hebdomadaires ne font pas
une tendance, et une moyenne glissante sur trois semaines a besoin de bien
plus de trois semaines. Ils ne remontent jamais avant ta première séance :
des zéros avant les données diraient « tu n'as rien soulevé » au lieu de
« on ne sait pas ».

| Panneau | Ce qu'il mesure |
| --- | --- |
| Journées d'entraînement, Séries de travail, Volume soulevé, Charge max, Dernière série | les chiffres clés de la période |
| Volume par journée, par séance | reps × charge, empilé par séance |
| Volume par semaine, Volume hebdo moyen | le volume de travail hebdomadaire et quatre moyennes : glissantes sur **1, 3 et 5 semaines**, plus celle depuis la première semaine entraînée de la période. Plus la fenêtre est large, plus la courbe est lisse — la courte suit la séance, la longue suit la saison. **Une semaine sans séance compte pour zéro** et les fait descendre ; les semaines d'avant la première séance n'existent pas. **La semaine entamée est à part**, en clair, et hors des moyennes : elle n'est pas finie, un lundi n'est pas une rechute. Le bloc « Volume hebdo moyen » est le dernier point de la moyenne depuis le début. |
| Séries de travail par semaine | régularité : séries et journées par semaine |
| Charge max par journée | par exercice, la série la plus lourde de chaque journée. Échauffement masqué par défaut (clique la légende). Sans filtre d'exercice, tout se superpose : choisis-en un |
| 1RM estimé (Epley) | charge × (1 + reps ÷ 30), et la charge elle-même à une seule répétition — une estimation, pas un record ; hors décharge |
| Exercices qui stagnent | la règle de l'app (#95), décharges écartées, sur tout l'historique : trois séances d'affilée à même charge max et même total de répétitions font un **plateau** ; la même performance avec un RPE moyen un cran plus haut est de la **fatigue**, à décharger ; la même charge tenue plus facilement n'est ni l'un ni l'autre |
| Records par exercice | charge max, meilleur 1RM estimé, journées, séries, volume, dernière fois — hors décharge |
| RPE moyen, Séries notées, Part notée | l'effort perçu sur les séries de travail notées |
| RPE moyen par journée | à charge égale, une courbe qui descend dit que la charge est devenue légère |
| Effort par exercice | RPE moyen et max, charge notée, dernière note — seuls les exercices notés |
| Repos médian pris, Intervalles mesurés | le repos réellement pris entre deux séries de travail d'une même journée, sur les horodatages — médiane, jamais moyenne |
| Repos par exercice | le repos réglé sur le chrono face au repos pris, et l'écart : positif, tu te reposes plus que prévu ; négatif, tu enchaînes |
| Repos pris par journée | par exercice, la médiane de chaque journée — une courbe qui monte à charge stable dit que la séance coûte plus |
| Poids actuel, Écart sur la période, Pesées | la dernière pesée, ce qu'elle a bougé, combien de jours pesés |
| Poids de corps | chaque pesée de l'app et sa moyenne sur 7 jours glissants — c'est elle qui dit la tendance — et, en violet, la balance Garmin |
| Volume rapporté au poids de corps | combien de fois ton propre poids tu as soulevé, par journée : progresser à poids stable, ou seulement peser plus lourd |
| Calories par jour | ce que tu as mangé chaque jour d'après `nutrition/repas.csv`, face à l'objectif réglé en haut de page ; un jour non noté n'apparaît pas, ne rien avoir noté n'est pas n'avoir rien mangé |
| Macros par jour | protéines, lipides, glucides du jour en grammes, empilés ; repère pour la force : 1,6 à 2 g de protéines par kilo de poids de corps |
| Kilomètres par semaine | ce que la montre a mesuré, empilé par famille — course (tapis et trail compris), vélo, marche et rando, autre — sur le même lundi que le volume soulevé, avec la moyenne sur 4 semaines glissantes ; la fonte n'y est pas, elle se compte en volume |
| Allure et fréquence cardiaque | une sortie, un point : allure moyenne à gauche (plus bas, plus rapide), FC moyenne à droite. Course seulement — une allure en min/km n'a pas de sens à vélo. L'allure qui descend à FC plate, c'est la forme qui monte |
| Répartition des séries | la part de chaque exercice, en séries et non en tonnage : c'est en séries par muscle que se lit l'équilibre d'un programme |
| Toutes les séries | le détail, RPE, échauffements et décharges compris, filtrable |

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

-- repos réellement pris par exercice, face au repos réglé (SQLite n'a pas de
-- MEDIAN : on garde les rangs du milieu et on les moyenne)
SELECT m.exercise_slug, e.rest_seconds AS regle, CAST(AVG(m.rest_seconds) AS INT) AS reel
FROM (
  SELECT exercise_slug, seance_slug, rest_seconds,
         ROW_NUMBER() OVER (PARTITION BY exercise_slug ORDER BY rest_seconds) AS rang,
         COUNT(*) OVER (PARTITION BY exercise_slug) AS n
  FROM rests_taken
) m
JOIN exercises e ON e.seance_slug = m.seance_slug AND e.slug = m.exercise_slug
WHERE m.rang IN ((m.n + 1) / 2, (m.n + 2) / 2)
GROUP BY m.exercise_slug ORDER BY reel - regle DESC

-- ce que tu as mangé face à ce que tu pèses, jour par jour
SELECT n.day, n.calories, n.protein_g,
       (SELECT b.kilograms FROM body_weights b
         WHERE b.day <= n.day ORDER BY b.day DESC LIMIT 1) AS poids
FROM nutrition_days n ORDER BY n.day

-- ce que chaque journal a apporté
SELECT source, COUNT(DISTINCT day) AS jours, COUNT(*) AS aliments
FROM meals GROUP BY source

-- la balance Garmin face à l'app, les jours où les deux ont parlé
SELECT g.day, g.kilograms AS garmin, b.kilograms AS app, g.body_fat_pct
FROM garmin_weights g JOIN body_weights b ON b.day = g.day ORDER BY g.day

-- la semaine d'entraînement en entier : le soulevé et le couru côte à côte
WITH semaines AS (SELECT week FROM working_sets
                  UNION SELECT week FROM garmin_activities)
SELECT s.week AS semaine,
       (SELECT SUM(volume) FROM working_sets w WHERE w.week = s.week) AS volume,
       (SELECT COUNT(DISTINCT day) FROM working_sets w WHERE w.week = s.week) AS journees,
       (SELECT ROUND(SUM(distance_m) / 1000, 1) FROM garmin_activities c
         WHERE c.week = s.week) AS km,
       (SELECT COUNT(*) FROM garmin_activities c WHERE c.week = s.week) AS sorties
FROM semaines s ORDER BY semaine

-- l'allure moyenne par mois, course seulement, et la FC qui va avec
SELECT substr(day, 1, 7) AS mois, COUNT(*) AS sorties,
       ROUND(SUM(distance_m) / 1000, 1) AS km,
       CAST(SUM(duration_s) / (SUM(distance_m) / 1000) / 60 AS INTEGER) || ':'
       || printf('%02d', CAST(SUM(duration_s) / (SUM(distance_m) / 1000) AS INTEGER) % 60) AS allure,
       ROUND(AVG(avg_hr)) AS fc
FROM garmin_activities WHERE sport LIKE '%running' AND distance_m > 0
GROUP BY mois ORDER BY mois

-- le poids de corps au jour de chaque séance
SELECT s.day, MAX(s.weight) AS charge,
       (SELECT b.kilograms FROM body_weights b
         WHERE b.day <= s.day ORDER BY b.day DESC LIMIT 1) AS poids
FROM working_sets s GROUP BY s.day ORDER BY s.day
```

## Tests

L'import a ses tests, bibliothèque standard seule comme lui, et la conversion
du journal MyFitnessPal aussi :

```sh
cd grafana && python3 -m unittest test_import_exports test_mfp_sync
```

Ils ne tournent pas dans la CI, qui ne monte pas de Python.
