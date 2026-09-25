---
name: releve
description: Use when the user asks to add a « relevé » or a Revenant export to Grafana, to refresh the Grafana database, to update the Garmin weigh-ins, or tells what they ate and wants it logged (« ajoute le relevé », « mets à jour la bdd », « j'ai mangé… », « note ce repas »).
---

# Relevé : mettre à jour la base Grafana

Un « relevé » est un export de l'app, `revenant-AAAA-MM-JJ.json`, déposé à la
**racine du dépôt**. Grafana ne lit que `grafana/exports/`. La base
`grafana/data/revenant.db` est **reconstruite en entier** à chaque démarrage du
service `chargeur`, à partir de trois sources, toutes ignorées par git.

| Source | Fichier | Qui l'écrit |
| --- | --- | --- |
| Séries, pesées de l'app | `grafana/exports/revenant-*.json` | copie depuis la racine |
| Repas tenus à la main | `grafana/nutrition/repas.csv` | toi, une ligne par aliment |
| Repas MyFitnessPal | `grafana/nutrition/mfp.csv` | `mfp_sync.py`, jours relus réécrits |
| Balance Garmin | `grafana/garmin/poids.csv` | `garmin_sync.py`, réécrit en entier |

## Étapes

```sh
cd /home/cyprien/vue/ghost-lift
# 1. Les relevés de la racine absents de grafana/exports (souvent un seul).
#    Rien à copier n'est pas une erreur : dis-le, et continue s'il y a un
#    repas ou des pesées à prendre.
for f in revenant-*.json; do
  if [ -e "$f" ] && [ ! -e "grafana/exports/$f" ]; then cp -v "$f" grafana/exports/; fi
done
# 2. Le journal MyFitnessPal, si l'utilisateur y saisit.
python3 grafana/mfp_sync.py
# 3. Les pesées Garmin : si demandé, ou si la dernière a plus d'une semaine.
tail -n 1 grafana/garmin/poids.csv | cut -d, -f1     # date de la dernière pesée
~/.local/share/pipx/venvs/garmin-mcp/bin/python grafana/garmin_sync.py
# 4. Reconstruire. Toujours -d : sans lui la commande ne rend jamais la main.
cd grafana && docker compose up -d
```

## Vérifier, et pas à l'œil

Le piège : si le chargeur échoue, **l'ancienne base reste en place** et
Grafana répond « ok ». Un tableau de bord qui s'affiche ne prouve rien.

```sh
docker compose ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}'   # chargeur exited 0
docker compose logs --no-log-prefix --tail=6 chargeur                    # la ligne du nouveau fichier, puis le total
curl -s localhost:3000/api/health
```

La dernière ligne du chargeur donne les comptes : exports, séries, pesées,
aliments, pesées Garmin. Rends-les à l'utilisateur, avec ce qui a changé. Un
`erreur :` dans les logs nomme le fichier et la ligne fautive : corrige la
source, relance.

## Noter un repas

**Si MyFitnessPal est connecté, écris-y, pas dans le CSV** : les outils
`fitness_search_food` puis `fitness_log_food` posent la vraie valeur
d'étiquette, et `mfp_sync.py` la ramène. Une journée tenue dans les deux
journaux fait échouer le chargeur, en la nommant.

Le CSV reste pour les jours sans MyFitnessPal, et pour l'histoire déjà
saisie.

Format : `date,heure,repas,aliment,kcal,proteines,lipides,glucides`, avec
`repas` ∈ `matin`, `midi`, `soir`, `collation`. Guillemets autour d'un aliment
qui contient une virgule. Décimales avec un **point** (`17.5`). Macros
**vides** quand tu ne les connais pas, jamais `0`.

- Estime toi-même à partir des quantités données, en portions réalistes, et
  écris la quantité dans le nom : `Steak haché 5 % (350 g)`.
- L'heure est celle du repas, pas celle de la saisie. Sans précision, prends
  l'heure courante et le repas qui lui correspond.
- Ajoute en fin de fichier (`>>`), reconstruis, puis rends le total du jour :
  `sqlite3 -header -column grafana/data/revenant.db "select * from nutrition_days order by day desc limit 1"`.
- Dis ce que tu as supposé (nombre de parts, grammage) pour qu'il corrige.

Garmin Connect refuse l'écriture nutrition sans abonnement Connect+ (403) :
ce CSV est le journal, ne retente pas Garmin.

## Ne jamais

Commiter un fichier de `grafana/exports/`, `nutrition/`, `garmin/`, `data/`
ou un `revenant-*.json` : ce sont des données personnelles.
