#!/usr/bin/env python3
"""Tests de `import_exports.py`. Bibliothèque standard seule, comme lui.

    cd grafana && python3 -m unittest test_import_exports -v

Le chargeur tourne dans un conteneur `python:3-alpine` nu : ces tests
n'installent rien et n'appellent aucun binaire, ils importent le module et
lisent la base qu'il écrit.
"""

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "import_exports.py")


def export(version=4, exported_at="2026-09-05T20:00:00.000Z", history=None, body_weights=None):
    """Une sauvegarde minimale : une séance, un exercice, ce qu'on lui passe."""
    payload = {
        "format": "ghost-lift-backup",
        "version": version,
        "exportedAt": exported_at,
        "seances": [
            {
                "slug": "lower",
                "name": "Lower",
                "exercises": [
                    {
                        "slug": "squat",
                        "name": "Squat",
                        "defaultReps": 5,
                        "defaultWeight": 100,
                        "weightUnit": "kg",
                        "restSeconds": 180,
                        "isDumbbell": False,
                    }
                ],
            }
        ],
        "history": history if history is not None else [],
    }
    if body_weights is not None:
        payload["bodyWeights"] = body_weights
    return payload


def sets(*items):
    return [{"seanceSlug": "lower", "exerciseSlug": "squat", "sets": list(items)}]


def one_set(completed_at, reps=5, weight=100.0, warmup=False, rpe=None):
    item = {"reps": reps, "weight": weight, "completedAt": completed_at, "isWarmup": warmup}
    if rpe is not None:
        item["rpe"] = rpe
    return item


class ImporterCase(unittest.TestCase):
    def run_importer(self, *exports):
        """Écrit les exports, lance le chargeur, rend (connexion, sortie)."""
        directory = tempfile.mkdtemp()
        self.addCleanup(lambda: None)
        for index, payload in enumerate(exports):
            path = os.path.join(directory, f"{index}-export.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)

        db_path = os.path.join(directory, "revenant.db")
        result = subprocess.run(
            [sys.executable, SCRIPT, directory, db_path],
            capture_output=True,
            text=True,
        )
        return result, db_path

    def rows(self, db_path, query):
        connection = sqlite3.connect(db_path)
        connection.row_factory = sqlite3.Row
        try:
            return [dict(row) for row in connection.execute(query)]
        finally:
            connection.close()


class BodyWeights(ImporterCase):
    def test_weights_land_in_their_own_table_oldest_first(self):
        result, db = self.run_importer(
            export(body_weights=[
                {"day": "2026-09-01", "kilograms": 74.2},
                {"day": "2026-08-30", "kilograms": 75.1},
            ])
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.rows(db, "SELECT day, kilograms FROM body_weights ORDER BY day"),
            [
                {"day": "2026-08-30", "kilograms": 75.1},
                {"day": "2026-09-01", "kilograms": 74.2},
            ],
        )

    def test_the_day_gets_a_timestamp_for_grafana(self):
        _, db = self.run_importer(export(body_weights=[{"day": "2026-09-01", "kilograms": 74.2}]))

        # Minuit UTC du jour de la pesée : le jour du pèse-personne est un jour
        # local, posé sur l'axe de temps sans décalage arbitraire.
        self.assertEqual(
            self.rows(db, "SELECT day_ts FROM body_weights"),
            [{"day_ts": 1788220800}],
        )

    def test_a_newer_export_wins_on_the_same_day(self):
        old = export(exported_at="2026-09-01T08:00:00.000Z",
                     body_weights=[{"day": "2026-09-01", "kilograms": 74.2}])
        new = export(exported_at="2026-09-05T08:00:00.000Z",
                     body_weights=[{"day": "2026-09-01", "kilograms": 73.8}])

        _, db = self.run_importer(old, new)

        # Une pesée corrigée dans l'app doit l'être aussi dans le tableau de
        # bord : la lecture la plus récente fait foi, comme dans l'app.
        self.assertEqual(
            self.rows(db, "SELECT kilograms FROM body_weights"),
            [{"kilograms": 73.8}],
        )

    def test_an_export_without_weights_leaves_the_table_empty(self):
        _, db = self.run_importer(export(version=3))

        self.assertEqual(self.rows(db, "SELECT * FROM body_weights"), [])

    def test_a_malformed_weight_is_refused(self):
        for bad in (
            {"day": "2026-02-30", "kilograms": 74.2},
            {"day": "01/09/2026", "kilograms": 74.2},
            {"day": "2026-09-01", "kilograms": 19.9},
            {"day": "2026-09-01", "kilograms": 400.1},
            {"day": "2026-09-01", "kilograms": 74.25},
        ):
            with self.subTest(bad=bad):
                result, _ = self.run_importer(export(body_weights=[bad]))
                self.assertEqual(result.returncode, 1)
                self.assertIn("erreur", result.stderr)


class Sets(ImporterCase):
    """Le comportement déjà en place, pour qu'il ne parte pas en silence."""

    def test_sets_are_deduplicated_across_exports(self):
        first = export(exported_at="2026-09-01T08:00:00.000Z",
                       history=sets(one_set("2026-09-01T10:00:00.000Z")))
        second = export(exported_at="2026-09-05T08:00:00.000Z",
                        history=sets(one_set("2026-09-01T10:00:00.000Z"),
                                     one_set("2026-09-03T10:00:00.000Z")))

        _, db = self.run_importer(first, second)

        self.assertEqual(self.rows(db, "SELECT COUNT(*) AS n FROM sets"), [{"n": 2}])

    def test_a_later_export_fills_in_a_missing_rpe(self):
        first = export(version=2, exported_at="2026-09-01T08:00:00.000Z",
                       history=sets(one_set("2026-09-01T10:00:00.000Z")))
        second = export(exported_at="2026-09-05T08:00:00.000Z",
                        history=sets(one_set("2026-09-01T10:00:00.000Z", rpe=8)))

        _, db = self.run_importer(first, second)

        self.assertEqual(self.rows(db, "SELECT rpe FROM sets"), [{"rpe": 8.0}])

    def test_an_invalid_rpe_is_refused(self):
        result, _ = self.run_importer(
            export(history=sets(one_set("2026-09-01T10:00:00.000Z", rpe=11)))
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("RPE", result.stderr)


if __name__ == "__main__":
    unittest.main()
