#!/usr/bin/env python3
"""Verse les exports Revenant dans une base SQLite lisible par Grafana.

Usage : import_exports.py <dossier des exports> <fichier .db>
                          [--repas repas.csv] [--poids-garmin poids.csv]

Lit tous les `*.json` du dossier au format `ghost-lift-backup` (v1 à v4),
du plus ancien au plus récent (`exportedAt`), et reconstruit la base à
chaque passage : le programme (noms, ordres) est celui de l'export le plus
récent, les séries de tous les exports sont réunies, dédoublonnées par
signature `séance | exercice | date | reps | charge` — la même règle que
l'app pour fusionner un import.

Versions : v1 le programme et l'historique, v2 `isWarmup` / `isDumbbell`,
v3 `rpe` (effort perçu, nullable), v4 `bodyWeights` (les pesées), v5
`isDeload` (séance de décharge), v6 `notes` (consignes de l'exercice), v7
`isBodyweight` (exercice au poids du corps, dont les séries peuvent porter un
lest nul). Une version plus récente que celle-ci passe quand même, ses champs
inconnus étant ignorés.

Deux sources facultatives s'ajoutent aux exports. `--repas` : le journal des
repas, un CSV tenu à la main (l'app ne connaît pas la nutrition), une ligne
par aliment — `date,heure,repas,aliment,kcal,proteines,lipides,glucides`.
`--poids-garmin` : les pesées de la balance Garmin, écrites par
`garmin_sync.py` — `date,kilogrammes,masse_grasse_pct,masse_musculaire_kg`.
Absentes, leurs tables (`meals`, `garmin_weights`) restent vides.

Bibliothèque standard uniquement : le script tourne dans un conteneur
`python:3-alpine` nu, sans rien installer.
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

FORMAT = "ghost-lift-backup"
NEWEST_VERSION = 7

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
    -- Consignes libres du programme (v6) ; chaîne vide quand il n'y en a pas.
    notes           TEXT NOT NULL DEFAULT '',
    -- Poids du corps (v7) : la charge des séries est le lest, zéro admis.
    is_bodyweight   INTEGER NOT NULL DEFAULT 0,
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
    -- Série d'une séance allégée volontairement (v5). Son volume compte —
    -- c'est du travail réel — mais elle n'est ni un record ni un plateau,
    -- comme dans l'app.
    is_deload     INTEGER NOT NULL DEFAULT 0,
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

-- Une ligne par aliment mangé, saisie à la main dans `repas.csv` : l'app ne
-- connaît pas la nutrition, c'est un journal tenu à côté. Le jour est celui
-- de l'assiette, un jour local comme la pesée, posé à minuit UTC pour la
-- même raison. Les macros valent NULL quand on ne les connaît pas : un plat
-- de restaurant sans étiquette n'a pas zéro protéine.
CREATE TABLE meals (
    id         INTEGER PRIMARY KEY,
    day        TEXT NOT NULL,
    day_ts     INTEGER NOT NULL,
    time       TEXT NOT NULL,
    -- matin, midi, soir ou collation.
    meal       TEXT NOT NULL,
    item       TEXT NOT NULL,
    calories   REAL NOT NULL,
    protein_g  REAL,
    fat_g      REAL,
    carbs_g    REAL
);

CREATE INDEX meals_by_day ON meals (day_ts);

-- Une pesée par jour sur la balance Garmin, tirée de Garmin Connect par
-- `garmin_sync.py`. Table à part de `body_weights` : le même jour, la
-- balance et l'app peuvent dire deux poids différents (l'heure, les
-- vêtements, une autre balance), et aucune des deux n'a tort — on les
-- superpose, on ne les fusionne pas. Masse grasse et masse musculaire
-- valent NULL quand la balance ne les a pas mesurées (pesée manuelle).
CREATE TABLE garmin_weights (
    day           TEXT PRIMARY KEY,
    kilograms     REAL NOT NULL,
    body_fat_pct  REAL,
    muscle_kg     REAL,
    day_ts        INTEGER NOT NULL
);

-- Une journée d'assiette : les totaux du jour, à croiser avec le poids de
-- corps et le volume soulevé. Une macro inconnue sur un seul aliment ne
-- compte pas dans le total du jour ; ce total est alors une borne basse.
CREATE VIEW nutrition_days AS
    SELECT day,
           day_ts,
           SUM(calories) AS calories,
           SUM(protein_g) AS protein_g,
           SUM(fat_g) AS fat_g,
           SUM(carbs_g) AS carbs_g,
           COUNT(*) AS items
    FROM meals
    GROUP BY day;

-- Les séries de travail : ce que mesurent les graphiques (l'échauffement ne
-- compte ni dans le volume ni dans les records, comme dans l'app).
CREATE VIEW working_sets AS
    SELECT * FROM sets WHERE is_warmup = 0;

-- Les séries qui visaient la performance : le travail hors décharge. C'est
-- sur elles que se lisent les records, le 1RM estimé et la stagnation ; une
-- décharge a fait ce qu'on lui demandait, elle ne bat rien et ne stagne pas.
CREATE VIEW performance_sets AS
    SELECT * FROM sets WHERE is_warmup = 0 AND is_deload = 0;

-- Une journée d'un exercice, vue comme l'app la voit : la charge la plus
-- lourde, le total de répétitions, et si toutes ses séries étaient une
-- décharge. C'est la matière de l'alerte de stagnation.
CREATE VIEW exercise_days AS
    SELECT seance_slug,
           exercise_slug,
           day,
           day_ts,
           MAX(weight) AS heaviest,
           SUM(reps) AS reps,
           SUM(volume) AS volume,
           -- L'effort perçu moyen des séries notées ; NULL si rien n'est noté.
           AVG(rpe) AS rpe,
           MIN(is_deload) AS is_deload
    FROM sets
    WHERE is_warmup = 0
    GROUP BY seance_slug, exercise_slug, day;

-- Le repos réellement pris entre deux séries de travail, mesuré sur les
-- horodatages — pas le repos réglé sur le chrono (#96). Une ligne par
-- intervalle : la première série d'une journée n'en a pas, elle ne compte pas
-- plutôt que de compter zéro. Au-delà du seuil, l'écart n'est plus un repos
-- mais une interruption de séance ; le seuil vaut celui de l'app
-- (`MAX_REST_SECONDS`, `src/lib/trainingInsights.ts`).
CREATE VIEW rests_taken AS
    SELECT * FROM (
        SELECT
            s.seance_slug,
            s.exercise_slug,
            s.day,
            s.day_ts,
            s.week_ts,
            s.completed_ts,
            s.completed_ts - (
                SELECT MAX(previous.completed_ts)
                  FROM sets previous
                 WHERE previous.is_warmup = 0
                   AND previous.seance_slug = s.seance_slug
                   AND previous.exercise_slug = s.exercise_slug
                   AND previous.day = s.day
                   AND previous.completed_ts < s.completed_ts
            ) AS rest_seconds
        FROM sets s
        WHERE s.is_warmup = 0
    )
    WHERE rest_seconds IS NOT NULL AND rest_seconds <= 900;
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


def parse_notes(value: object, context: str) -> str:
    """Les consignes d'un exercice (v6) : du texte, ou rien."""
    if value is None:
        return ""
    if not isinstance(value, str):
        fail(f"{context} : consignes illisibles « {value} »")
    return value.strip()


def parse_deload(value: object, context: str) -> int:
    """Le drapeau de décharge (v5) : vrai, faux, ou absent (faux)."""
    if value is None:
        return 0
    if not isinstance(value, bool):
        fail(f"{context} : drapeau de décharge illisible « {value} »")
    return 1 if value else 0


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


MEAL_COLUMNS = ["date", "heure", "repas", "aliment", "kcal", "proteines", "lipides", "glucides"]
MEALS = ("matin", "midi", "soir", "collation")


def parse_meal_row(row: dict, context: str) -> tuple:
    """Une ligne du journal des repas, telle qu'elle entre dans `meals`."""
    day = row["date"]
    try:
        parsed = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        fail(f"{context} : « {day} » n'est pas un jour calendaire (AAAA-MM-JJ)")

    time = row["heure"]
    try:
        datetime.strptime(time, "%H:%M")
    except ValueError:
        fail(f"{context} : « {time} » n'est pas une heure (HH:MM), repas du {day}")

    meal = row["repas"].strip()
    if meal not in MEALS:
        fail(f"{context} : le repas se note {', '.join(MEALS)} (« {meal} »), repas du {day}")

    item = row["aliment"].strip()
    if not item:
        fail(f"{context} : aliment sans nom, repas du {day} à {time}")

    def grams(column: str, required: bool) -> float | None:
        raw = row[column].strip()
        if not raw:
            if required:
                fail(f"{context} : {column} absent pour « {item} », repas du {day}")
            return None
        try:
            value = float(raw.replace(",", "."))
        except ValueError:
            fail(f"{context} : {column} illisible « {raw} » pour « {item} », repas du {day}")
        if value < 0:
            fail(f"{context} : {column} négatif « {raw} » pour « {item} », repas du {day}")
        return value

    return (
        day,
        int(parsed.timestamp()),
        time,
        meal,
        item,
        grams("kcal", required=True),
        grams("proteines", required=False),
        grams("lipides", required=False),
        grams("glucides", required=False),
    )


GARMIN_COLUMNS = ["date", "kilogrammes", "masse_grasse_pct", "masse_musculaire_kg"]


def parse_garmin_row(row: dict, context: str) -> tuple:
    """Une ligne des pesées Garmin, telle qu'elle entre dans `garmin_weights`."""
    day = row["date"]
    try:
        parsed = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        fail(f"{context} : « {day} » n'est pas un jour calendaire (AAAA-MM-JJ)")

    def number(column: str, low: float, high: float, required: bool) -> float | None:
        raw = row[column].strip()
        if not raw:
            if required:
                fail(f"{context} : {column} absent, pesée du {day}")
            return None
        try:
            value = float(raw.replace(",", "."))
        except ValueError:
            fail(f"{context} : {column} illisible « {raw} », pesée du {day}")
        if not low <= value <= high:
            fail(f"{context} : {column} hors de {low}–{high} (« {raw} »), pesée du {day}")
        return value

    return (
        day,
        number("kilogrammes", 20, 400, required=True),
        number("masse_grasse_pct", 1, 80, required=False),
        number("masse_musculaire_kg", 5, 200, required=False),
        int(parsed.timestamp()),
    )


def load_csv(db: sqlite3.Connection, path: str, columns: list[str], insert: str, parse) -> int:
    """Verse un CSV à en-tête fixe, une ligne par INSERT. Rend le nombre de lignes."""
    context = os.path.basename(path)
    written = 0

    with open(path, encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != columns:
            fail(f"{context} : l'en-tête attendu est {','.join(columns)}")
        for number, row in enumerate(reader, start=2):
            if None in row or any(value is None for value in row.values()):
                fail(f"{context} : ligne {number}, {len(columns)} colonnes attendues")
            try:
                db.execute(insert, parse(row, f"{context} : ligne {number}"))
            except sqlite3.IntegrityError as error:
                fail(f"{context} : ligne {number}, {error} (deux fois le même jour ?)")
            written += 1

    return written


def load_meals(db: sqlite3.Connection, path: str) -> int:
    """Verse le journal des repas. Rend le nombre d'aliments écrits."""
    return load_csv(
        db,
        path,
        MEAL_COLUMNS,
        "INSERT INTO meals (day, day_ts, time, meal, item, calories, protein_g, fat_g, carbs_g) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        parse_meal_row,
    )


def load_garmin_weights(db: sqlite3.Connection, path: str) -> int:
    """Verse les pesées Garmin. Rend le nombre de jours écrits."""
    return load_csv(
        db,
        path,
        GARMIN_COLUMNS,
        "INSERT INTO garmin_weights (day, kilograms, body_fat_pct, muscle_kg, day_ts) "
        "VALUES (?, ?, ?, ?, ?)",
        parse_garmin_row,
    )


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
                     weight_unit, rest_seconds, is_dumbbell, notes, is_bodyweight, position)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    parse_notes(exercise.get("notes"), f"{export['_file']} / {exercise['slug']}"),
                    1 if exercise.get("isBodyweight") else 0,
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


def load_history(db: sqlite3.Connection, export: dict) -> tuple[int, int, int]:
    """Verse les séries d'un export.

    Rend (séries nouvelles, RPE complétés, décharges mises à jour).
    """
    inserted = 0
    filled = 0
    redeloaded = 0
    for entry in export.get("history") or []:
        context = f"{export['_file']} / {entry.get('exerciseSlug')}"
        for item in entry.get("sets", []):
            completed = parse_timestamp(item.get("completedAt"), context)
            day = completed.replace(hour=0, minute=0, second=0, microsecond=0)
            monday = day - timedelta(days=day.weekday())
            reps = item["reps"]
            weight = item["weight"]
            rpe = parse_rpe(item.get("rpe"), context)
            is_deload = parse_deload(item.get("isDeload"), context)
            completed_at = completed.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            cursor = db.execute(
                """
                INSERT OR IGNORE INTO sets
                    (seance_slug, exercise_slug, reps, weight, is_warmup, rpe, is_deload,
                     volume, completed_at, completed_ts, day, day_ts, week, week_ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry["seanceSlug"],
                    entry["exerciseSlug"],
                    reps,
                    weight,
                    1 if item.get("isWarmup") else 0,
                    rpe,
                    is_deload,
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
                continue

            # La décharge se décide après coup, et se défait de même : c'est
            # une lecture de la séance, pas de la série, et la plus récente
            # fait foi — l'export le plus récent est la dernière décision.
            # Une v4 ne porte pas le drapeau : elle ne défait rien.
            if export["version"] >= 5:
                redeloaded += db.execute(
                    """
                    UPDATE sets SET is_deload = ?
                    WHERE seance_slug = ? AND exercise_slug = ? AND completed_at = ?
                      AND reps = ? AND weight = ? AND is_deload != ?
                    """,
                    (
                        is_deload,
                        entry["seanceSlug"],
                        entry["exerciseSlug"],
                        completed_at,
                        reps,
                        weight,
                        is_deload,
                    ),
                ).rowcount

            if rpe is not None:
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

    return inserted, filled, redeloaded


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("exports_dir")
    parser.add_argument("db_path")
    parser.add_argument("--repas", default=None)
    parser.add_argument("--poids-garmin", dest="garmin", default=None)
    try:
        args = parser.parse_args()
    except SystemExit:
        fail(
            "usage : import_exports.py <dossier des exports> <fichier .db> "
            "[--repas repas.csv] [--poids-garmin poids.csv]"
        )

    exports_dir, db_path = args.exports_dir, args.db_path
    meals_path, garmin_path = args.repas, args.garmin
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
            count, filled, redeloaded = load_history(db, export)
            weighed = load_body_weights(db, export)
            db.execute(
                "INSERT INTO exports (file, exported_at, version, set_count) VALUES (?, ?, ?, ?)",
                (export["_file"], export["_exported_at"].isoformat(), export["version"], count),
            )
            note = f", {filled} RPE complété(s)" if filled else ""
            decharges = f", {redeloaded} décharge(s) mise(s) à jour" if redeloaded else ""
            pesees = f", {weighed} pesée(s)" if weighed else ""
            print(f"{export['_file']} : {count} série(s) nouvelle(s){note}{decharges}{pesees}")

        if meals_path and os.path.exists(meals_path):
            eaten = load_meals(db, meals_path)
            print(f"{os.path.basename(meals_path)} : {eaten} aliment(s)")
        if garmin_path and os.path.exists(garmin_path):
            weighed = load_garmin_weights(db, garmin_path)
            print(f"{os.path.basename(garmin_path)} : {weighed} pesée(s) Garmin")

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
    deloads = db.execute("SELECT COUNT(*) FROM working_sets WHERE is_deload = 1").fetchone()[0]
    warmups = db.execute("SELECT COUNT(*) FROM sets WHERE is_warmup = 1").fetchone()[0]
    weights = db.execute("SELECT COUNT(*) FROM body_weights").fetchone()[0]
    eaten, fed_days = db.execute("SELECT COUNT(*), COUNT(DISTINCT day) FROM meals").fetchone()
    garmin = db.execute("SELECT COUNT(*) FROM garmin_weights").fetchone()[0]
    db.close()

    os.replace(temporary, db_path)
    # Grafana tourne sous un autre utilisateur que le chargeur : la base doit
    # rester lisible par tous.
    os.chmod(db_path, 0o644)
    print(
        f"{db_path} : {len(exports)} export(s), {total} séries de travail "
        f"({rated} notée(s) d'un RPE, {deloads} de décharge), {warmups} d'échauffement "
        f"et {weights} pesée(s)"
        + (f", {eaten} aliment(s) sur {fed_days} jour(s)" if eaten else "")
        + (f", {garmin} pesée(s) Garmin" if garmin else "")
    )


if __name__ == "__main__":
    main()
