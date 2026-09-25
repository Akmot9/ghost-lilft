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


def one_set(completed_at, reps=5, weight=100.0, warmup=False, rpe=None, deload=None):
    item = {"reps": reps, "weight": weight, "completedAt": completed_at, "isWarmup": warmup}
    if rpe is not None:
        item["rpe"] = rpe
    if deload is not None:
        item["isDeload"] = deload
    return item


class ImporterCase(unittest.TestCase):
    def run_importer(self, *exports, nutrition=None, garmin=None, mfp=None, cardio=None):
        """Écrit les exports (et les CSV des repas, des repas MyFitnessPal, des
        pesées Garmin et du cardio Garmin, s'il y en a), lance le chargeur, rend
        (résultat, chemin de la base)."""
        directory = tempfile.mkdtemp()
        self.addCleanup(lambda: None)
        for index, payload in enumerate(exports):
            path = os.path.join(directory, f"{index}-export.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)

        db_path = os.path.join(directory, "revenant.db")
        command = [sys.executable, SCRIPT, directory, db_path]
        for flag, name, content in (("--repas", "repas.csv", nutrition),
                                    ("--repas-mfp", "mfp.csv", mfp),
                                    ("--poids-garmin", "poids.csv", garmin),
                                    ("--cardio-garmin", "cardio.csv", cardio)):
            if content is not None:
                csv_path = os.path.join(directory, name)
                with open(csv_path, "w", encoding="utf-8") as handle:
                    handle.write(content)
                command += [flag, csv_path]
        result = subprocess.run(command, capture_output=True, text=True)
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


class Deloads(ImporterCase):
    """La décharge (v5) : du travail réel, mais ni un record ni un plateau."""

    def test_the_flag_lands_and_stays_out_of_performance_sets(self):
        _, db = self.run_importer(
            export(version=5, history=sets(one_set("2026-09-01T10:00:00.000Z"),
                                           one_set("2026-09-03T10:00:00.000Z", weight=60, deload=True)))
        )

        self.assertEqual(
            self.rows(db, "SELECT weight, is_deload FROM working_sets ORDER BY completed_ts"),
            [{"weight": 100.0, "is_deload": 0}, {"weight": 60.0, "is_deload": 1}],
        )
        self.assertEqual(self.rows(db, "SELECT weight FROM performance_sets"), [{"weight": 100.0}])

    def test_a_newer_export_decides_the_deload_both_ways(self):
        marked = export(version=5, exported_at="2026-09-01T08:00:00.000Z",
                        history=sets(one_set("2026-09-01T10:00:00.000Z", deload=True)))
        unmarked = export(version=5, exported_at="2026-09-05T08:00:00.000Z",
                          history=sets(one_set("2026-09-01T10:00:00.000Z", deload=False)))

        _, db = self.run_importer(marked, unmarked)

        # Marquer puis démarquer dans l'app : le tableau de bord suit la
        # dernière décision, comme pour une pesée corrigée.
        self.assertEqual(self.rows(db, "SELECT is_deload FROM sets"), [{"is_deload": 0}])

    def test_an_older_format_does_not_undo_a_deload(self):
        marked = export(version=5, exported_at="2026-09-01T08:00:00.000Z",
                        history=sets(one_set("2026-09-01T10:00:00.000Z", deload=True)))
        legacy = export(version=4, exported_at="2026-09-05T08:00:00.000Z",
                        history=sets(one_set("2026-09-01T10:00:00.000Z")))

        _, db = self.run_importer(marked, legacy)

        self.assertEqual(self.rows(db, "SELECT is_deload FROM sets"), [{"is_deload": 1}])

    def test_a_day_is_a_deload_only_when_all_its_sets_are(self):
        _, db = self.run_importer(
            export(version=5, history=sets(one_set("2026-09-01T10:00:00.000Z", deload=True),
                                           one_set("2026-09-01T10:03:00.000Z", weight=110)))
        )

        self.assertEqual(
            self.rows(db, "SELECT heaviest, reps, is_deload FROM exercise_days"),
            [{"heaviest": 110.0, "reps": 10, "is_deload": 0}],
        )

    def test_a_v6_export_passes_without_a_warning_and_keeps_the_notes(self):
        payload = export(version=6)
        payload["seances"][0]["exercises"][0]["notes"] = " Top set puis −10 % "

        result, db = self.run_importer(payload)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("attention", result.stderr)
        self.assertEqual(self.rows(db, "SELECT notes FROM exercises"), [{"notes": "Top set puis −10 %"}])

    def test_a_v7_export_keeps_the_bodyweight_flag_and_its_unloaded_sets(self):
        payload = export(version=7, history=sets(one_set("2026-09-01T10:00:00.000Z", weight=0)))
        payload["seances"][0]["exercises"][0]["isBodyweight"] = True
        payload["seances"][0]["exercises"][0]["defaultWeight"] = 0

        result, db = self.run_importer(payload)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.rows(db, "SELECT is_bodyweight FROM exercises"), [{"is_bodyweight": 1}])
        self.assertEqual(self.rows(db, "SELECT weight FROM sets"), [{"weight": 0.0}])


class RestsTakenTest(ImporterCase):
    """Le repos réellement pris, mesuré sur les horodatages (#96)."""

    def test_the_gap_between_two_working_sets_of_a_day_is_a_rest(self):
        _, db = self.run_importer(
            export(history=sets(one_set("2026-09-01T10:00:00.000Z"),
                                one_set("2026-09-01T10:03:00.000Z", reps=6)))
        )

        self.assertEqual(
            self.rows(db, "SELECT rest_seconds FROM rests_taken"),
            [{"rest_seconds": 180}],
        )

    def test_the_gap_between_two_days_is_not_a_rest(self):
        _, db = self.run_importer(
            export(history=sets(one_set("2026-09-01T10:00:00.000Z"),
                                one_set("2026-09-03T10:00:00.000Z", reps=6)))
        )

        self.assertEqual(self.rows(db, "SELECT rest_seconds FROM rests_taken"), [])

    def test_an_interruption_is_not_a_rest(self):
        _, db = self.run_importer(
            export(history=sets(one_set("2026-09-01T10:00:00.000Z"),
                                one_set("2026-09-01T10:20:00.000Z", reps=6)))
        )

        self.assertEqual(self.rows(db, "SELECT rest_seconds FROM rests_taken"), [])

    def test_warmup_sets_are_not_counted(self):
        _, db = self.run_importer(
            export(history=sets(one_set("2026-09-01T10:00:00.000Z", warmup=True),
                                one_set("2026-09-01T10:01:00.000Z", warmup=True),
                                one_set("2026-09-01T10:04:00.000Z", reps=6),
                                one_set("2026-09-01T10:07:00.000Z", reps=7)))
        )

        self.assertEqual(
            self.rows(db, "SELECT rest_seconds FROM rests_taken"),
            [{"rest_seconds": 180}],
        )


REPAS_HEADER = "date,heure,repas,aliment,kcal,proteines,lipides,glucides\n"


class Meals(ImporterCase):
    """Les repas, saisis dans un CSV à côté des exports : une ligne par aliment."""

    def test_without_a_file_the_table_is_empty(self):
        result, db = self.run_importer(export())

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.rows(db, "SELECT * FROM meals"), [])

    def test_items_land_in_meals_with_the_day_timestamp(self):
        result, db = self.run_importer(
            export(),
            nutrition=REPAS_HEADER
            + "2026-09-19,13:00,midi,Magret de canard (500 g),1150,95,85,0\n"
            + "2026-09-19,13:00,midi,Baguette (250 g),680,22,3,140\n",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.rows(
                db,
                "SELECT day, day_ts, time, meal, item, calories, protein_g, fat_g, carbs_g "
                "FROM meals ORDER BY id",
            ),
            [
                {"day": "2026-09-19", "day_ts": 1789776000, "time": "13:00", "meal": "midi",
                 "item": "Magret de canard (500 g)", "calories": 1150.0,
                 "protein_g": 95.0, "fat_g": 85.0, "carbs_g": 0.0},
                {"day": "2026-09-19", "day_ts": 1789776000, "time": "13:00", "meal": "midi",
                 "item": "Baguette (250 g)", "calories": 680.0,
                 "protein_g": 22.0, "fat_g": 3.0, "carbs_g": 140.0},
            ],
        )
        self.assertIn("2 aliment(s)", result.stdout)

    def test_a_day_adds_up_in_nutrition_days(self):
        _, db = self.run_importer(
            export(),
            nutrition=REPAS_HEADER
            + "2026-09-19,13:00,midi,Magret,1150,95,85,0\n"
            + "2026-09-19,20:30,soir,Riz,400,8,2,90\n"
            + "2026-09-18,08:00,matin,Flocons,300,10,5,50\n",
        )

        self.assertEqual(
            self.rows(
                db,
                "SELECT day, calories, protein_g, fat_g, carbs_g, items "
                "FROM nutrition_days ORDER BY day",
            ),
            [
                {"day": "2026-09-18", "calories": 300.0, "protein_g": 10.0, "fat_g": 5.0,
                 "carbs_g": 50.0, "items": 1},
                {"day": "2026-09-19", "calories": 1550.0, "protein_g": 103.0, "fat_g": 87.0,
                 "carbs_g": 90.0, "items": 2},
            ],
        )

    def test_a_missing_macro_is_null_not_zero(self):
        _, db = self.run_importer(
            export(),
            nutrition=REPAS_HEADER + "2026-09-19,13:00,midi,Un truc au resto,900,,,\n",
        )

        # Ne pas connaître les macros d'un plat n'est pas en connaître zéro.
        self.assertEqual(
            self.rows(db, "SELECT calories, protein_g, fat_g, carbs_g FROM meals"),
            [{"calories": 900.0, "protein_g": None, "fat_g": None, "carbs_g": None}],
        )

    def test_a_malformed_line_is_refused(self):
        for bad in (
            "2026-02-30,13:00,midi,Magret,1150,95,85,0",
            "19/09/2026,13:00,midi,Magret,1150,95,85,0",
            "2026-09-19,25:00,midi,Magret,1150,95,85,0",
            "2026-09-19,13:00,brunch,Magret,1150,95,85,0",
            "2026-09-19,13:00,midi,,1150,95,85,0",
            "2026-09-19,13:00,midi,Magret,,95,85,0",
            "2026-09-19,13:00,midi,Magret,-5,95,85,0",
            "2026-09-19,13:00,midi,Magret,1150,beaucoup,85,0",
            "2026-09-19,13:00,midi,Magret,1150,95,85",
        ):
            with self.subTest(bad=bad):
                result, _ = self.run_importer(export(), nutrition=REPAS_HEADER + bad + "\n")
                self.assertEqual(result.returncode, 1)
                self.assertIn("erreur", result.stderr)
                self.assertIn("repas.csv", result.stderr)

    def test_a_wrong_header_is_refused(self):
        result, _ = self.run_importer(
            export(),
            nutrition="jour,heure,repas,aliment,kcal,proteines,lipides,glucides\n",
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("erreur", result.stderr)


POIDS_HEADER = "date,kilogrammes,masse_grasse_pct,masse_musculaire_kg\n"


class GarminWeights(ImporterCase):
    """Les pesées de la balance Garmin, tirées par `garmin_sync.py` dans un CSV.

    Elles ont leur propre table : le même jour, la balance et l'app peuvent
    dire deux poids différents, et aucune des deux n'a tort."""

    def test_without_a_file_the_table_is_empty(self):
        result, db = self.run_importer(export())

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.rows(db, "SELECT * FROM garmin_weights"), [])

    def test_weigh_ins_land_in_their_own_table_with_the_day_timestamp(self):
        result, db = self.run_importer(
            export(body_weights=[{"day": "2026-09-08", "kilograms": 69.2}]),
            garmin=POIDS_HEADER + "2026-09-08,68.47,19.9,29.84\n2026-09-01,68.9,,\n",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.rows(db, "SELECT day, day_ts, kilograms, body_fat_pct, muscle_kg "
                          "FROM garmin_weights ORDER BY day"),
            [
                {"day": "2026-09-01", "day_ts": 1788220800, "kilograms": 68.9,
                 "body_fat_pct": None, "muscle_kg": None},
                {"day": "2026-09-08", "day_ts": 1788825600, "kilograms": 68.47,
                 "body_fat_pct": 19.9, "muscle_kg": 29.84},
            ],
        )
        # La pesée de l'app reste ce qu'elle est : les deux sources cohabitent.
        self.assertEqual(self.rows(db, "SELECT kilograms FROM body_weights"), [{"kilograms": 69.2}])
        self.assertIn("2 pesée(s) Garmin", result.stdout)

    def test_a_malformed_weigh_in_is_refused(self):
        for bad in (
            "2026-02-30,68.5,,",
            "08/09/2026,68.5,,",
            "2026-09-08,,,",
            "2026-09-08,lourd,,",
            "2026-09-08,19.9,,",
            "2026-09-08,68.5,120,",
            "2026-09-08,68.5",
        ):
            with self.subTest(bad=bad):
                result, _ = self.run_importer(export(), garmin=POIDS_HEADER + bad + "\n")
                self.assertEqual(result.returncode, 1)
                self.assertIn("erreur", result.stderr)
                self.assertIn("poids.csv", result.stderr)

    def test_the_same_day_twice_is_refused(self):
        result, _ = self.run_importer(
            export(), garmin=POIDS_HEADER + "2026-09-08,68.5,,\n2026-09-08,68.7,,\n"
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("erreur", result.stderr)


class MyFitnessPal(ImporterCase):
    """Le journal MyFitnessPal, tiré par `mfp_sync.py`, à côté de celui tenu à
    la main : deux fichiers, une seule table, et jamais le même jour deux fois."""

    def test_each_row_carries_the_journal_it_came_from(self):
        result, db = self.run_importer(
            export(),
            nutrition=REPAS_HEADER + "2026-09-19,13:00,midi,Magret,1150,95,85,0\n",
            mfp=REPAS_HEADER + "2026-09-20,12:30,midi,Oeufs,540,39,42,2\n",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.rows(db, "SELECT day, item, source FROM meals ORDER BY day"),
            [
                {"day": "2026-09-19", "item": "Magret", "source": "manuel"},
                {"day": "2026-09-20", "item": "Oeufs", "source": "myfitnesspal"},
            ],
        )
        self.assertIn("1 aliment(s)", result.stdout)

    def test_the_two_journals_fill_different_days(self):
        _, db = self.run_importer(
            export(),
            nutrition=REPAS_HEADER + "2026-09-19,13:00,midi,Magret,1150,95,85,0\n",
            mfp=REPAS_HEADER
            + "2026-09-20,12:30,midi,Oeufs,540,39,42,2\n"
            + "2026-09-20,20:00,soir,Riz,400,8,2,90\n",
        )

        self.assertEqual(
            self.rows(db, "SELECT day, calories, items FROM nutrition_days ORDER BY day"),
            [
                {"day": "2026-09-19", "calories": 1150.0, "items": 1},
                {"day": "2026-09-20", "calories": 940.0, "items": 2},
            ],
        )

    def test_a_day_written_in_both_journals_is_refused(self):
        result, _ = self.run_importer(
            export(),
            nutrition=REPAS_HEADER + "2026-09-20,13:00,midi,Magret,1150,95,85,0\n",
            mfp=REPAS_HEADER + "2026-09-20,12:30,midi,Oeufs,540,39,42,2\n",
        )

        # Additionner doublerait les calories du jour, choisir un gagnant
        # effacerait l'autre en silence : on refuse en nommant le jour.
        self.assertEqual(result.returncode, 1)
        self.assertIn("erreur", result.stderr)
        self.assertIn("2026-09-20", result.stderr)

    def test_without_a_file_only_the_hand_written_journal_counts(self):
        result, db = self.run_importer(
            export(), nutrition=REPAS_HEADER + "2026-09-19,13:00,midi,Magret,1150,95,85,0\n"
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.rows(db, "SELECT source FROM meals"), [{"source": "manuel"}]
        )


CARDIO_HEADER = ("activite_id,debut,sport,nom,distance_m,duree_s,"
                 "fc_moy,fc_max,denivele_m,calories\n")
COURSE = "24484475176,2026-09-24 17:59:38,running,La Garde Course à pied,10636,4026,147,163,75,778\n"
TAPIS = '24000000001,2026-09-20 07:38:21,treadmill_running,"Tapis, 18 km",18392,8964,,,,1310\n'


class GarminActivities(ImporterCase):
    """Le cardio de Garmin Connect, tiré par `garmin_cardio_sync.py` dans un CSV.

    La fonte n'y est pas : elle vient de l'app, avec ses reps et ses charges.
    Ce que Garmin apporte, c'est ce que l'app ne saura jamais — courir."""

    def test_without_a_file_the_table_is_empty(self):
        result, db = self.run_importer(export())

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.rows(db, "SELECT * FROM garmin_activities"), [])

    def test_an_activity_lands_with_its_day_and_its_monday(self):
        result, db = self.run_importer(export(), cardio=CARDIO_HEADER + COURSE)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.rows(db, "SELECT * FROM garmin_activities"),
            [{
                "activity_id": 24484475176,
                "started_at": "2026-09-24 17:59:38",
                "sport": "running",
                "name": "La Garde Course à pied",
                "distance_m": 10636.0,
                "duration_s": 4026.0,
                "avg_hr": 147.0,
                "max_hr": 163.0,
                "elevation_m": 75.0,
                "calories": 778.0,
                # Le départ, l'heure locale posée comme si elle était UTC :
                # c'est lui qui sépare deux sorties d'une même journée.
                "started_ts": 1790272778,
                "day": "2026-09-24",
                "day_ts": 1790208000,
                # Le lundi de la semaine, comme pour les séries : c'est ce qui
                # permet de poser les kilomètres et le volume sur le même axe.
                "week": "2026-09-21",
                "week_ts": 1789948800,
            }],
        )
        self.assertIn("1 activité(s) cardio", result.stdout)

    def test_what_the_watch_did_not_measure_stays_null(self):
        _, db = self.run_importer(export(), cardio=CARDIO_HEADER + TAPIS)

        # Tapis sans ceinture : ni FC ni dénivelé. NULL, pas zéro — un zéro
        # tirerait la FC moyenne de la saison vers le bas.
        self.assertEqual(
            self.rows(db, "SELECT name, avg_hr, max_hr, elevation_m, calories "
                          "FROM garmin_activities"),
            [{"name": "Tapis, 18 km", "avg_hr": None, "max_hr": None,
              "elevation_m": None, "calories": 1310.0}],
        )

    def test_two_activities_the_same_day_both_land(self):
        result, db = self.run_importer(
            export(),
            cardio=CARDIO_HEADER + COURSE
            + "24484475177,2026-09-24 07:10:00,cycling,Aller au travail,8200,1500,121,140,40,210\n",
        )

        # Une journée peut porter deux sorties : la clé est l'identifiant
        # Garmin, pas le jour.
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.rows(db, "SELECT sport FROM garmin_activities ORDER BY started_at"),
            [{"sport": "cycling"}, {"sport": "running"}],
        )
        self.assertIn("2 activité(s) cardio", result.stdout)

    def test_the_same_activity_twice_is_refused(self):
        result, _ = self.run_importer(export(), cardio=CARDIO_HEADER + COURSE + COURSE)

        self.assertEqual(result.returncode, 1)
        self.assertIn("erreur", result.stderr)

    def test_a_malformed_activity_is_refused(self):
        for bad in (
            "24484475176,24/09/2026 17:59:38,running,Course,10636,4026,147,163,75,778",
            "24484475176,2026-09-31 17:59:38,running,Course,10636,4026,147,163,75,778",
            "24484475176,2026-09-24,running,Course,10636,4026,147,163,75,778",
            "pas-un-id,2026-09-24 17:59:38,running,Course,10636,4026,147,163,75,778",
            "24484475176,2026-09-24 17:59:38,,Course,10636,4026,147,163,75,778",
            "24484475176,2026-09-24 17:59:38,running,Course,10636,,147,163,75,778",
            "24484475176,2026-09-24 17:59:38,running,Course,10636,longtemps,147,163,75,778",
            "24484475176,2026-09-24 17:59:38,running,Course,-500,4026,147,163,75,778",
            "24484475176,2026-09-24 17:59:38,running,Course,10636,4026,320,163,75,778",
            "24484475176,2026-09-24 17:59:38,running,Course,10636,4026,147,163,75",
        ):
            with self.subTest(bad=bad):
                result, _ = self.run_importer(export(), cardio=CARDIO_HEADER + bad + "\n")
                self.assertEqual(result.returncode, 1)
                self.assertIn("erreur", result.stderr)
                self.assertIn("cardio.csv", result.stderr)

    def test_the_fonte_of_the_app_is_untouched_by_the_cardio(self):
        result, db = self.run_importer(export(), cardio=CARDIO_HEADER + COURSE)

        # Les deux journaux cohabitent sans se mélanger : un kilomètre couru
        # n'est pas du volume soulevé.
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.rows(db, "SELECT COUNT(*) AS n FROM sets"),
            self.rows(db, "SELECT COUNT(*) AS n FROM sets"),
        )
        self.assertEqual(self.rows(db, "SELECT COUNT(*) AS n FROM garmin_activities"),
                         [{"n": 1}])


if __name__ == "__main__":
    unittest.main()
