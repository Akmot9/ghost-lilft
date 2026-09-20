#!/usr/bin/env python3
"""Tire le journal alimentaire MyFitnessPal dans `grafana/nutrition/mfp.csv`.

    python3 mfp_sync.py
    docker compose up -d

Le chargeur (`import_exports.py --repas-mfp`) verse ensuite ce CSV dans la
table `meals`, à côté de `nutrition/repas.csv` tenu à la main. Chaque ligne
garde son journal d'origine dans `source` ; un jour écrit dans les deux fait
échouer le chargeur, plutôt que de doubler les calories de la journée.

Le script passe par le serveur MCP `mfp-mcp` (`claude mcp add myfitnesspal`),
qu'il lance et pilote en JSON-RPC sur son entrée standard. C'est l'interface
publique du serveur, plus stable que ses fonctions internes, et c'est lui qui
porte le cookie posé par `mfp-mcp auth`. Si MyFitnessPal répond « non
autorisé », c'est que la session a expiré : relancer `mfp-mcp auth` **dans une
autre fenêtre de terminal**, jamais dans celle de Claude Code, où le cookie
entrerait dans la conversation.

Le serveur ne remplit son cache que sur une fenêtre de jours (`--jours`, 120
par défaut). Les journées hors de cette fenêtre ne sont pas relues, et le
script **garde** alors ce que le CSV disait d'elles : une fenêtre plus courte
ne perd pas l'histoire déjà tirée.

Bibliothèque standard uniquement, comme le chargeur.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT = os.path.join(HERE, "nutrition", "mfp.csv")
COLUMNS = ["date", "heure", "repas", "aliment", "kcal", "proteines", "lipides", "glucides"]

# MyFitnessPal nomme ses repas en anglais et ne leur donne pas d'heure. On
# rend à chacun son nom français et une heure plausible : le journal en
# demande une, et c'est le jour qui porte le sens, pas la minute.
MEALS = {
    "breakfast": ("matin", "08:00"),
    "lunch": ("midi", "12:30"),
    "dinner": ("soir", "20:00"),
    "snacks": ("collation", "16:00"),
    "snack": ("collation", "16:00"),
}


def fail(message: str) -> None:
    print(f"erreur : {message}", file=sys.stderr)
    sys.exit(1)


def amount(value: object) -> str:
    """Une valeur nutritionnelle, ou rien du tout.

    Une macro que MyFitnessPal ne connaît pas reste **vide** : le chargeur la
    lit comme inconnue, et le total du jour devient une borne basse. Zéro
    serait une affirmation.
    """
    if value is None or value == "":
        return ""
    return f"{float(value):g}"


def journal_row(day: str, entry: dict) -> list[str]:
    """Une entrée MyFitnessPal, telle qu'elle entre dans le journal.

    Attention à l'ordre : MyFitnessPal rend protéines, glucides, lipides ; le
    journal attend protéines, **lipides**, glucides. Les intervertir passerait
    inaperçu sur un graphique.
    """
    key = str(entry.get("meal") or "").strip().lower()
    if key not in MEALS:
        fail(
            f"repas « {entry.get('meal')} » inconnu (journée du {day}) — "
            f"MyFitnessPal laisse renommer ses repas ; ajoute-le à MEALS"
        )
    meal, hour = MEALS[key]
    return [
        day,
        hour,
        meal,
        str(entry.get("name") or "").strip(),
        amount(entry.get("calories")),
        amount(entry.get("protein")),
        amount(entry.get("fat")),
        amount(entry.get("carbs")),
    ]


def merged(previous: list[list[str]], fetched: list[list[str]]) -> list[list[str]]:
    """Les journées relues remplacent les leurs, les autres restent.

    Remplacer plutôt qu'ajouter : sinon un aliment compterait deux fois à
    chaque passage. Garder les journées non relues : sinon une fenêtre plus
    courte effacerait ce qu'un passage précédent avait tiré.
    """
    relues = {row[0] for row in fetched}
    gardees = [row for row in previous if row[0] not in relues]
    return sorted(gardees + fetched, key=lambda row: (row[0], row[1]))


def read_journal(path: str) -> list[list[str]]:
    """Le CSV déjà écrit, sans son en-tête. Absent, c'est un journal vide."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    return [row for row in rows[1:] if row]


class Server:
    """Le serveur MyFitnessPal, lancé et parlé en JSON-RPC sur stdin/stdout."""

    def __init__(self, command: str, lookback_days: int) -> None:
        environment = dict(os.environ, MFP_SYNC_DAYS=str(lookback_days))
        self._log = tempfile.NamedTemporaryFile(prefix="mfp-sync-", suffix=".log")
        try:
            self._process = subprocess.Popen(
                [command],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=self._log,
                text=True,
                env=environment,
            )
        except FileNotFoundError:
            fail(f"« {command} » introuvable — installe-le avec `pipx install mfp-mcp`")
        self._next_id = 0
        self._request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "mfp_sync", "version": "1"},
        })
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def __enter__(self) -> "Server":
        return self

    def __exit__(self, *_: object) -> None:
        self._process.terminate()
        self._process.wait(timeout=10)
        self._log.close()

    def _send(self, message: dict) -> None:
        self._process.stdin.write(json.dumps(message) + "\n")
        self._process.stdin.flush()

    def _request(self, method: str, params: dict) -> dict:
        self._next_id += 1
        self._send({"jsonrpc": "2.0", "id": self._next_id, "method": method, "params": params})
        # Le serveur écrit aussi ses lignes de journal sur la sortie standard
        # (`notifications/message`). On lit jusqu'à retrouver *sa* réponse,
        # reconnue à l'identifiant, au lieu de prendre la première venue.
        while True:
            line = self._process.stdout.readline()
            if not line:
                self._log.seek(0)
                detail = self._log.read().decode("utf-8", "replace").strip().splitlines()
                tail = "\n".join(detail[-5:]) if detail else "(pas de message)"
                fail(f"le serveur MyFitnessPal s'est arrêté ; ses dernières lignes :\n{tail}")
            message = json.loads(line)
            if message.get("id") == self._next_id:
                return message

    def call(self, tool: str, arguments: dict) -> object:
        """Un outil du serveur. Rend ce qu'il répond, décodé quand c'est du JSON."""
        answer = self._request("tools/call", {"name": tool, "arguments": arguments})
        if "error" in answer:
            fail(f"{tool} : {answer['error'].get('message', answer['error'])}")
        text = answer["result"]["content"][0]["text"]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Le serveur rend ses propres erreurs en texte brut.
            fail(f"{tool} : {text}")


def logged_days(server: Server, since: str, until: str) -> list[str]:
    """Les journées où quelque chose a été noté, et elles seules."""
    trend = server.call("fitness_get_trends", {
        "metric": "calories_in", "start": since, "end": until,
    })
    if not isinstance(trend, dict):
        fail(f"réponse inattendue de fitness_get_trends : {str(trend)[:200]}")
    return [point["day"] for point in trend.get("points", [])]


def main() -> None:
    parser = argparse.ArgumentParser(description="Tire le journal MyFitnessPal dans un CSV.")
    parser.add_argument("--jours", type=int, default=120,
                        help="fenêtre de jours relus (défaut : 120)")
    parser.add_argument("--sortie", default=DEFAULT_OUTPUT,
                        help=f"CSV à écrire (défaut : {DEFAULT_OUTPUT})")
    parser.add_argument("--serveur", default="mfp-mcp",
                        help="commande du serveur MyFitnessPal (défaut : mfp-mcp)")
    args = parser.parse_args()

    if args.jours < 1:
        fail("--jours veut un nombre de jours positif")

    until = date.today()
    since = until - timedelta(days=args.jours)

    fetched: list[list[str]] = []
    with Server(args.serveur, args.jours) as server:
        days = logged_days(server, since.isoformat(), until.isoformat())
        for day in days:
            record = server.call("fitness_get_day", {"date": day})
            if not isinstance(record, dict):
                fail(f"réponse inattendue pour le {day} : {str(record)[:200]}")
            for entry in record.get("diary") or []:
                fetched.append(journal_row(day, entry))

    rows = merged(read_journal(args.sortie), fetched)

    os.makedirs(os.path.dirname(args.sortie) or ".", exist_ok=True)
    temporary = f"{args.sortie}.tmp"
    with open(temporary, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(COLUMNS)
        writer.writerows(rows)
    os.replace(temporary, args.sortie)

    span = f"du {rows[0][0]} au {rows[-1][0]}" if rows else "aucune"
    jours = len({row[0] for row in rows})
    print(
        f"{args.sortie} : {len(rows)} aliment(s) sur {jours} jour(s), {span} "
        f"({len(days)} journée(s) relue(s) sur les {args.jours} derniers jours)"
    )


if __name__ == "__main__":
    main()
