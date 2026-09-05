#!/usr/bin/env python3
"""Verse les exports Revenant dans une base SQLite lisible par Grafana.

Usage : import_exports.py <dossier des exports> <fichier .db>

Lit tous les `*.json` du dossier au format `ghost-lift-backup` (v1 à v4),
du plus ancien au plus récent (`exportedAt`), et reconstruit la base à
chaque passage : le programme (noms, ordres) est celui de l'export le plus
récent, les séries de tous les exports sont réunies, dédoublonnées par
signature `séance | exercice | date | reps | charge` — la même règle que
l'app pour fusionner un import.

Versions : v1 le programme et l'historique, v2 `isWarmup` / `isDumbbell`,
v3 `rpe` (effort perçu, nullable), v4 `bodyWeights` (les pesées). Une version
plus récente que celle-ci passe quand même, ses champs inconnus étant
ignorés.

Bibliothèque standard uniquement : le script tourne dans un conteneur
`python:3-alpine` nu, sans rien installer.
"""

from __future__ import annotations

import glob
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

FORMAT = "ghost-lift-backup"
NEWEST_VERSION = 4

SCHEMA = """
CREATE TABLE exports (
    file         TEXT PRIMARY KEY,
    exported_at  TEXT NOT NULL,
    version      INTEGER NOT NULL,
    set_count    INTEGER NOT NULL
);

CREATE TABLE seances (
    slug      TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    position  INTEGER NOT NULL
);

CREATE TABLE exercises (
    seance_slug     TEXT NOT NULL REFERENCES seances(slug),
    slug            TEXT NOT NULL,
    name            TEXT NOT NULL,
    default_reps    INTEGER NOT NULL,
    default_weight  REAL NOT NULL,
    weight_unit     TEXT NOT NULL,
    rest_seconds    INTEGER NOT NULL,
    is_dumbbell     INTEGER NOT NULL DEFAULT 0,
    position        INTEGER NOT NULL,
    PRIMARY KEY (seance_slug, slug)
);

-- Une ligne par série. Les colonnes de temps sont précalculées pour que les
-- requêtes du tableau de bord restent lisibles :
--   completed_ts : instant de la série, en secondes Unix ;
--   day / day_ts : journée d'entraînement (jour UTC, comme dans l'app) ;
--   week / week_ts : lundi UTC de la semaine.
CREATE TABLE sets (
    id            INTEGER PRIMARY KEY,
    seance_slug   TEXT NOT NULL,
    exercise_slug TEXT NOT NULL,
    reps          INTEGER NOT NULL,
    weight        REAL NOT NULL,
    is_warmup     INTEGER NOT NULL DEFAULT 0,
    -- Effort perçu, de 1 à 10 au demi-point près (v3). NULL quand la série
    -- n'est pas notée : l'app ne devine jamais un effort, la base non plus.
    rpe           REAL,
    volume        REAL NOT NULL,
    completed_at  TEXT NOT NULL,
    completed_ts  INTEGER NOT NULL,
    day           TEXT NOT NULL,
    day_ts        INTEGER NOT NULL,
    week          TEXT NOT NULL,
    week_ts       INTEGER NOT NULL,
    UNIQUE (seance_slug, exercise_slug, completed_at, reps, weight)
);

CREATE INDEX sets_by_time ON sets (completed_ts);
CREATE INDEX sets_by_exercise ON sets (seance_slug, exercise_slug, completed_ts);

-- Une ligne par pesée, une par jour calendaire. Le jour est celui du
-- pèse-personne — le jour *local* de la pesée, quand les séries sont datées
-- en UTC. Les deux ne se comparent qu'à l'échelle où un décalage d'un jour
-- ne change rien (tendance, moyenne) ; `day_ts` pose donc le jour à minuit
-- UTC, sans inventer de fuseau.
CREATE TABLE body_weights (
    day        TEXT PRIMARY KEY,
    kilograms  REAL NOT NULL,
    day_ts     INTEGER NOT NULL
);

-- Les séries de travail : ce que mesurent les graphiques (l'échauffement ne
-- compte ni dans le volume ni dans les records, comme dans l'app).
CREATE VIEW working_sets AS
    SELECT * FROM sets WHERE is_warmup = 0;
"""


def fail(message: str) -> None:
    print(f"erreur : {message}", file=sys.stderr)
    sys.exit(1)


def parse_timestamp(value: object, context: str) -> datetime:
    if not isinstance(value, str):
        fail(f"{context} : date absente")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        fail(f"{context} : date illisible « {value} »")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_rpe(value: object, context: str) -> float | None:
    """Le RPE se note de 1 à 10, au demi-point près — ou pas du tout.

    Mêmes règles que l'app (code d'erreur `rpe-invalide`). Absent ou `null`,
    la série reste non notée : c'est une information, pas un trou à combler.
    """
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail(f"{context} : RPE illisible « {value} »")
    if not 1 <= value <= 10 or (value * 2) % 1 != 0:
        fail(f"{context} : le RPE se note de 1 à 10, au demi-point près (« {value} »)")
    return float(value)


def parse_body_weight(entry: object, context: str) -> tuple[str, float, int]:
    """Une pesée : un jour calendaire et un poids, aux règles de l'app.

    De 20 à 400 kg au dixième près (`poids-corps-invalide`), un jour réel du
    calendrier — Rust reste autoritaire (`src-tauri/src/body_weight.rs`).
    """
    if not isinstance(entry, dict):
        fail(f"{context} : pesée illisible")

    day = entry.get("day")
    if not isinstance(day, str) or len(day) != 10:
        fail(f"{context} : « {day} » n'est pas un jour calendaire (AAAA-MM-JJ)")

    try:
        parsed = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        fail(f"{context} : « {day} » n'est pas un jour calendaire (AAAA-MM-JJ)")

    kilograms = entry.get("kilograms")
    if isinstance(kilograms, bool) or not isinstance(kilograms, (int, float)):
        fail(f"{context} : poids illisible « {kilograms} » (pesée du {day})")
    if not 20 <= kilograms <= 400 or (kilograms * 10) % 1 != 0:
        fail(
            f"{context} : la pesée du {day} s'écrit en kilogrammes, "
            f"au dixième près, entre 20 et 400 (« {kilograms} »)"
        )

    return day, float(kilograms), int(parsed.timestamp())


def read_export(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        try:
            payload = json.load(handle)
        except json.JSONDecodeError as error:
            fail(f"{path} : JSON invalide ({error})")

    if not isinstance(payload, dict) or payload.get("format") != FORMAT:
        fail(f"{path} : ce n'est pas une sauvegarde Revenant")

    version = payload.get("version")
    if not isinstance(version, int) or version < 1:
        fail(f"{path} : version de sauvegarde inconnue")
    if version > NEWEST_VERSION:
        print(
            f"attention : {path} vient d'une version plus récente (v{version}), "
            "les champs inconnus seront ignorés",
            file=sys.stderr,
        )

    if not isinstance(payload.get("seances"), list):
        fail(f"{path} : aucune séance")

    payload["_file"] = os.path.basename(path)
    payload["_exported_at"] = parse_timestamp(payload.get("exportedAt"), path)
    return payload


def load_program(db: sqlite3.Connection, export: dict) -> None:
    """Le programme est remplacé par celui de l'export le plus récent."""
    db.execute("DELETE FROM exercises")
    db.execute("DELETE FROM seances")

    for seance_position, seance in enumerate(export["seances"]):
        db.execute(
            "INSERT INTO seances (slug, name, position) VALUES (?, ?, ?)",
            (seance["slug"], seance["name"], seance_position),
        )
        for exercise_position, exercise in enumerate(seance.get("exercises", [])):
            db.execute(
                """
                INSERT INTO exercises
                    (seance_slug, slug, name, default_reps, default_weight,
                     weight_unit, rest_seconds, is_dumbbell, position)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    seance["slug"],
                    exercise["slug"],
                    exercise["name"],
                    exercise["defaultReps"],
                    exercise["defaultWeight"],
                    exercise["weightUnit"],
                    exercise["restSeconds"],
                    1 if exercise.get("isDumbbell") else 0,
                    exercise_position,
                ),
            )


def load_body_weights(db: sqlite3.Connection, export: dict) -> int:
    """Verse les pesées d'un export. Rend le nombre de jours écrits.

    Contrairement aux séries, la pesée d'un jour déjà connu est *remplacée* :
    une même journée peut légitimement porter deux poids différents dans deux
    exports, et l'export le plus récent est la lecture la plus récente — la
    même règle que l'app quand on repèse le même jour.
    """
    written = 0

    for entry in export.get("bodyWeights") or []:
        day, kilograms, day_ts = parse_body_weight(entry, export["_file"])
        db.execute(
            """
            INSERT INTO body_weights (day, kilograms, day_ts) VALUES (?, ?, ?)
            ON CONFLICT(day) DO UPDATE SET kilograms = excluded.kilograms
            """,
            (day, kilograms, day_ts),
        )
        written += 1

    return written


def load_history(db: sqlite3.Connection, export: dict) -> tuple[int, int]:
    """Verse les séries d'un export. Rend (séries nouvelles, RPE complétés)."""
    inserted = 0
    filled = 0
    for entry in export.get("history") or []:
        context = f"{export['_file']} / {entry.get('exerciseSlug')}"
        for item in entry.get("sets", []):
            completed = parse_timestamp(item.get("completedAt"), context)
            day = completed.replace(hour=0, minute=0, second=0, microsecond=0)
            monday = day - timedelta(days=day.weekday())
            reps = item["reps"]
            weight = item["weight"]
            rpe = parse_rpe(item.get("rpe"), context)
            completed_at = completed.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            cursor = db.execute(
                """
                INSERT OR IGNORE INTO sets
                    (seance_slug, exercise_slug, reps, weight, is_warmup, rpe, volume,
                     completed_at, completed_ts, day, day_ts, week, week_ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry["seanceSlug"],
                    entry["exerciseSlug"],
                    reps,
                    weight,
                    1 if item.get("isWarmup") else 0,
                    rpe,
                    reps * weight,
                    completed_at,
                    int(completed.timestamp()),
                    day.date().isoformat(),
                    int(day.timestamp()),
                    monday.date().isoformat(),
                    int(monday.timestamp()),
                ),
            )
            if cursor.rowcount:
                inserted += 1
            elif rpe is not None:
                # La signature de dédoublonnage ignore le RPE : une v2 puis une
                # v3 de la même séance décrivent les mêmes séries, seule la
                # seconde les note. On complète alors ce qui manque — sans
                # jamais écraser une note déjà là, le premier jugement porté
                # sur une série reste le sien.
                filled += db.execute(
                    """
                    UPDATE sets SET rpe = ?
                    WHERE seance_slug = ? AND exercise_slug = ? AND completed_at = ?
                      AND reps = ? AND weight = ? AND rpe IS NULL
                    """,
                    (
                        rpe,
                        entry["seanceSlug"],
                        entry["exerciseSlug"],
                        completed_at,
                        reps,
                        weight,
                    ),
                ).rowcount

    return inserted, filled


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage : import_exports.py <dossier des exports> <fichier .db>")

    exports_dir, db_path = sys.argv[1], sys.argv[2]
    paths = sorted(glob.glob(os.path.join(exports_dir, "*.json")))
    if not paths:
        fail(f"aucun export *.json dans {exports_dir} — dépose-y une sauvegarde Revenant")

    exports = sorted((read_export(path) for path in paths), key=lambda e: e["_exported_at"])

    temporary = f"{db_path}.tmp"
    for stale in (temporary, f"{temporary}-journal"):
        if os.path.exists(stale):
            os.remove(stale)

    db = sqlite3.connect(temporary)
    db.executescript(SCHEMA)

    with db:
        load_program(db, exports[-1])
        for export in exports:
            count, filled = load_history(db, export)
            weighed = load_body_weights(db, export)
            db.execute(
                "INSERT INTO exports (file, exported_at, version, set_count) VALUES (?, ?, ?, ?)",
                (export["_file"], export["_exported_at"].isoformat(), export["version"], count),
            )
            note = f", {filled} RPE complété(s)" if filled else ""
            pesees = f", {weighed} pesée(s)" if weighed else ""
            print(f"{export['_file']} : {count} série(s) nouvelle(s){note}{pesees}")

    orphans = db.execute(
        """
        SELECT COUNT(*) FROM sets s
        LEFT JOIN exercises e ON e.seance_slug = s.seance_slug AND e.slug = s.exercise_slug
        WHERE e.slug IS NULL
        """
    ).fetchone()[0]
    if orphans:
        print(
            f"attention : {orphans} série(s) d'exercices absents du dernier programme "
            "(exercices supprimés) — gardées, mais sans nom",
            file=sys.stderr,
        )

    total, rated = db.execute("SELECT COUNT(*), COUNT(rpe) FROM working_sets").fetchone()
    warmups = db.execute("SELECT COUNT(*) FROM sets WHERE is_warmup = 1").fetchone()[0]
    weights = db.execute("SELECT COUNT(*) FROM body_weights").fetchone()[0]
    db.close()

    os.replace(temporary, db_path)
    # Grafana tourne sous un autre utilisateur que le chargeur : la base doit
    # rester lisible par tous.
    os.chmod(db_path, 0o644)
    print(
        f"{db_path} : {len(exports)} export(s), {total} séries de travail "
        f"({rated} notée(s) d'un RPE), {warmups} d'échauffement "
        f"et {weights} pesée(s)"
    )


if __name__ == "__main__":
    main()
