#!/usr/bin/env python3
"""Tire le cardio de Garmin Connect dans `garmin/cardio.csv`.

    ~/.local/share/pipx/venvs/garmin-mcp/bin/python garmin_cardio_sync.py
    docker compose up -d

Le chargeur (`import_exports.py --cardio-garmin`) verse ensuite ce CSV dans la
table `garmin_activities` à chaque démarrage. Le fichier est réécrit en entier
à chaque passage : Garmin Connect fait foi, rien n'est fusionné — comme pour
les pesées, et contrairement au journal MyFitnessPal qui ne voit qu'une
fenêtre de jours.

Ce qui entre : **tout sauf la fonte et les conteneurs multi-sport.** La fonte
vient de l'app, série par série, avec des reps et une charge que Garmin ne
connaît pas ; la reprendre ici la compterait deux fois. Une activité
multi-sport est un parent dont Garmin rend aussi les segments : garder le
parent doublerait la sortie. Le reste passe avec son `sport` en colonne, sans
liste blanche à tenir à jour — une nouvelle activité un jour de neige arrive
toute seule.

L'allure n'est pas stockée : elle se dérive de la durée et de la distance,
comme les vues du chargeur dérivent le reste.

Le script s'appuie sur `garminconnect`, installé avec le serveur MCP Garmin
(pipx), et sur les jetons OAuth de `~/.garminconnect` posés par
`garmin-mcp-auth` — pas de mot de passe ici. Si Garmin répond 401, relance
`garmin-mcp-auth`.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT = os.path.join(HERE, "garmin", "cardio.csv")
TOKENS = "~/.garminconnect"
COLUMNS = ["activite_id", "debut", "sport", "nom", "distance_m", "duree_s",
           "fc_moy", "fc_max", "denivele_m", "calories"]
FONTE = "strength_training"
PAGE = 100


def measured(value: object) -> bool:
    """Garmin met 0 quand rien n'a mesuré : ce n'est pas une valeur.

    Un tapis sans ceinture rend une FC à 0 et un dénivelé à 0. Charger ces
    zéros tirerait toutes les moyennes vers le bas ; une course vraiment plate
    garde de toute façon quelques mètres de bruit GPS."""
    return value not in (None, "") and float(value) > 0


def is_cardio(activity: dict) -> bool:
    """Ce qui a sa place dans ce journal."""
    if activity["activityType"]["typeKey"] == FONTE:
        return False
    if activity.get("parent"):
        return False
    # Sans durée, ce n'est pas une séance : rien à tracer, et le chargeur
    # refuserait la ligne en bloquant toute la base.
    return measured(activity.get("duration"))


def as_round(value: object) -> str:
    return f"{round(float(value))}" if measured(value) else ""


def csv_row(activity: dict) -> list[str]:
    """Une activité, telle qu'elle entre dans le journal."""
    return [
        str(activity["activityId"]),
        activity["startTimeLocal"],
        activity["activityType"]["typeKey"],
        activity.get("activityName") or "",
        as_round(activity.get("distance")),
        as_round(activity.get("duration")),
        as_round(activity.get("averageHR")),
        as_round(activity.get("maxHR")),
        as_round(activity.get("elevationGain")),
        as_round(activity.get("calories")),
    ]


def rows_from(activities: list[dict]) -> list[list[str]]:
    """Le journal complet : le cardio seul, du plus ancien au plus récent.

    Garmin rend le plus récent d'abord ; le CSV se lit dans l'autre sens."""
    rows = [csv_row(a) for a in activities if is_cardio(a)]
    rows.sort(key=lambda row: row[1])
    return rows


def connect():
    """Ouvre la session Garmin.

    L'import est ici, pas en tête de fichier : le tri du catalogue se teste
    avec le Python système, qui n'a pas `garminconnect`."""
    try:
        from garminconnect import Garmin
    except ImportError:
        print(
            "erreur : `garminconnect` introuvable — lance ce script avec le Python du "
            "serveur MCP : ~/.local/share/pipx/venvs/garmin-mcp/bin/python "
            "garmin_cardio_sync.py",
            file=sys.stderr,
        )
        sys.exit(1)
    client = Garmin()
    client.login(TOKENS)
    return client


def fetch_all(client, since: str) -> list[dict]:
    """Toutes les activités jusqu'à `since`, page par page.

    Garmin pagine et ne sait pas filtrer par date ici : on remonte jusqu'à
    tomber avant `since`, puis on s'arrête."""
    activities: list[dict] = []
    start = 0
    while True:
        page = client.get_activities(start, PAGE)
        if not page:
            return activities
        activities += [a for a in page if a["startTimeLocal"][:10] >= since]
        if page[-1]["startTimeLocal"][:10] < since:
            return activities
        start += PAGE


def main() -> None:
    parser = argparse.ArgumentParser(description="Tire le cardio Garmin dans un CSV.")
    parser.add_argument("--depuis", default="2015-01-01", help="premier jour à garder (AAAA-MM-JJ)")
    parser.add_argument("--sortie", default=DEFAULT_OUTPUT, help=f"CSV à écrire (défaut : {DEFAULT_OUTPUT})")
    args = parser.parse_args()

    rows = rows_from(fetch_all(connect(), args.depuis))

    os.makedirs(os.path.dirname(args.sortie), exist_ok=True)
    temporary = f"{args.sortie}.tmp"
    with open(temporary, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(COLUMNS)
        writer.writerows(rows)
    os.replace(temporary, args.sortie)

    span = f"du {rows[0][1][:10]} au {rows[-1][1][:10]}" if rows else "aucune"
    print(f"{args.sortie} : {len(rows)} activité(s) cardio, {span}")


if __name__ == "__main__":
    main()
