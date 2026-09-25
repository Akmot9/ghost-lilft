#!/usr/bin/env python3
"""Tire les pesées de la balance Garmin dans `garmin/poids.csv`.

    ~/.local/share/pipx/venvs/garmin-mcp/bin/python garmin_sync.py
    docker compose up -d

Le chargeur (`import_exports.py --poids-garmin`) verse ensuite ce CSV dans la
table `garmin_weights` à chaque démarrage. Le fichier est réécrit en entier à
chaque passage : Garmin Connect fait foi, rien n'est fusionné.

Le script s'appuie sur `garminconnect`, installé avec le serveur MCP Garmin
(pipx), et sur les jetons OAuth de `~/.garminconnect` posés par
`garmin-mcp-auth` — pas de mot de passe ici. Si Garmin répond 401, relance
`garmin-mcp-auth`.

Une ligne par jour pesé : `date,kilogrammes,masse_grasse_pct,masse_musculaire_kg`.
Quand la balance a servi plusieurs fois le même jour, la dernière pesée du
jour est gardée, comme dans Garmin Connect. Masse grasse et masse musculaire
restent vides quand la balance ne les a pas mesurées — Garmin note alors
0,0, qui n'est pas une mesure.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import date

try:
    from garminconnect import Garmin
except ImportError:
    print(
        "erreur : `garminconnect` introuvable — lance ce script avec le Python du "
        "serveur MCP : ~/.local/share/pipx/venvs/garmin-mcp/bin/python garmin_sync.py",
        file=sys.stderr,
    )
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT = os.path.join(HERE, "garmin", "poids.csv")
TOKENS = "~/.garminconnect"
COLUMNS = ["date", "kilogrammes", "masse_grasse_pct", "masse_musculaire_kg"]


def latest_of_day(summary: dict) -> dict | None:
    """La dernière pesée d'un jour, celle que Garmin Connect affiche."""
    latest = summary.get("latestWeight")
    if latest and latest.get("weight"):
        return latest
    metrics = [m for m in summary.get("allWeightMetrics") or [] if m.get("weight")]
    return max(metrics, key=lambda m: m.get("timestampGMT") or 0) if metrics else None


def measured(value: object) -> bool:
    """Garmin met 0 quand la balance n'a pas mesuré : ce n'est pas une valeur."""
    return value not in (None, "") and float(value) > 0


def as_kg(grams: object) -> str:
    return f"{float(grams) / 1000:.2f}" if measured(grams) else ""


def as_pct(value: object) -> str:
    return f"{float(value):.1f}" if measured(value) else ""


def main() -> None:
    parser = argparse.ArgumentParser(description="Tire les pesées Garmin dans un CSV.")
    parser.add_argument("--depuis", default="2015-01-01", help="premier jour à demander (AAAA-MM-JJ)")
    parser.add_argument("--sortie", default=DEFAULT_OUTPUT, help=f"CSV à écrire (défaut : {DEFAULT_OUTPUT})")
    args = parser.parse_args()

    client = Garmin()
    client.login(TOKENS)
    payload = client.get_weigh_ins(args.depuis, date.today().isoformat())

    rows = []
    for summary in payload.get("dailyWeightSummaries") or []:
        latest = latest_of_day(summary)
        if latest is None:
            continue
        rows.append({
            "date": summary["summaryDate"],
            "kilogrammes": as_kg(latest["weight"]),
            "masse_grasse_pct": as_pct(latest.get("bodyFat")),
            "masse_musculaire_kg": as_kg(latest.get("muscleMass")),
        })
    rows.sort(key=lambda r: r["date"])

    os.makedirs(os.path.dirname(args.sortie), exist_ok=True)
    temporary = f"{args.sortie}.tmp"
    with open(temporary, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(temporary, args.sortie)

    span = f"du {rows[0]['date']} au {rows[-1]['date']}" if rows else "aucune"
    print(f"{args.sortie} : {len(rows)} pesée(s) Garmin, {span}")


if __name__ == "__main__":
    main()
