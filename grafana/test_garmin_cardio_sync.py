#!/usr/bin/env python3
"""Tests de `garmin_cardio_sync.py`. Bibliothèque standard seule, comme lui.

    cd grafana && python3 -m unittest test_garmin_cardio_sync -v

Seul le tri du catalogue est testé : le reste du script parle à Garmin
Connect par le réseau, comme `garmin_sync.py`. Le risque est ici — Garmin rend
la fonte, le vélo, la course et des conteneurs multi-sport dans la même liste,
et deux d'entre eux n'ont rien à faire dans ce journal.
"""

import unittest

import garmin_cardio_sync as sync


def activity(sport="running", started="2026-09-24 17:59:38", identifier=24484475176,
             name="La Garde Course à pied", distance=10636.04, duration=4026.49,
             avg_hr=147.0, max_hr=163.0, elevation=75.15, calories=778.0, parent=False):
    return {
        "activityId": identifier,
        "activityName": name,
        "activityType": {"typeKey": sport},
        "startTimeLocal": started,
        "distance": distance,
        "duration": duration,
        "averageHR": avg_hr,
        "maxHR": max_hr,
        "elevationGain": elevation,
        "calories": calories,
        "parent": parent,
    }


class WhatCounts(unittest.TestCase):
    """La règle : tout sauf la fonte et les conteneurs multi-sport."""

    def test_strength_training_is_left_out(self):
        # La fonte vient de l'app, série par série. La reprendre ici la
        # compterait deux fois, et Garmin n'en connaît ni les reps ni la charge.
        self.assertFalse(sync.is_cardio(activity(sport="strength_training")))

    def test_a_multi_sport_container_is_left_out_but_its_segments_are_not(self):
        # Garmin rend le parent ET ses segments. Garder le parent compterait
        # la sortie deux fois.
        self.assertFalse(sync.is_cardio(activity(sport="multi_sport", parent=True)))
        self.assertTrue(sync.is_cardio(activity(sport="cycling")))

    def test_every_other_sport_passes_with_its_own_name(self):
        for sport in ("running", "treadmill_running", "trail_running", "cycling",
                      "indoor_cycling", "hiking", "walking", "resort_skiing"):
            with self.subTest(sport=sport):
                self.assertTrue(sync.is_cardio(activity(sport=sport)))
                self.assertEqual(sync.csv_row(activity(sport=sport))[2], sport)

    def test_an_activity_without_a_duration_is_left_out(self):
        # Sans durée, ce n'est pas une séance : rien à tracer, et le chargeur
        # la refuserait en bloquant toute la base pour une ligne.
        self.assertFalse(sync.is_cardio(activity(duration=None)))
        self.assertFalse(sync.is_cardio(activity(duration=0)))


class JournalRow(unittest.TestCase):
    def test_a_run_lands_in_the_journal_order(self):
        row = sync.csv_row(activity())

        self.assertEqual(row, ["24484475176", "2026-09-24 17:59:38", "running",
                               "La Garde Course à pied", "10636", "4026",
                               "147", "163", "75", "778"])

    def test_distance_and_duration_are_rounded_not_truncated(self):
        # L'allure se dérive de ces deux nombres : un mètre et une seconde
        # d'écart ne changent rien, une troncature systématique se verrait.
        row = sync.csv_row(activity(distance=10636.9, duration=4026.6))

        self.assertEqual(row[4:6], ["10637", "4027"])

    def test_what_the_watch_did_not_measure_stays_empty(self):
        # Tapis sans ceinture : pas de FC, pas de dénivelé. Garmin note alors
        # None ou 0,0 — un 0 n'est pas une mesure, et un 0 chargé tirerait
        # toutes les moyennes vers le bas.
        row = sync.csv_row(activity(avg_hr=None, max_hr=0.0, elevation=0.0, calories=None))

        self.assertEqual(row[6:], ["", "", "", ""])

    def test_a_name_with_a_comma_survives_the_csv(self):
        rows = sync.rows_from([activity(name="Fractionné, 8 × 400 m")])

        self.assertEqual(rows[0][3], "Fractionné, 8 × 400 m")


class Catalogue(unittest.TestCase):
    def test_two_runs_the_same_day_are_both_kept(self):
        # Le jour ne suffit pas à distinguer deux sorties : c'est pour ça que
        # la clé est l'identifiant Garmin, pas la date.
        rows = sync.rows_from([
            activity(identifier=1, started="2026-09-24 07:10:00"),
            activity(identifier=2, started="2026-09-24 17:59:38"),
        ])

        self.assertEqual([row[0] for row in rows], ["1", "2"])

    def test_the_journal_comes_out_oldest_first(self):
        # Garmin rend le plus récent d'abord ; le CSV se lit dans l'autre sens.
        rows = sync.rows_from([
            activity(identifier=2, started="2026-09-24 17:59:38"),
            activity(identifier=1, started="2026-08-26 18:09:53"),
        ])

        self.assertEqual([row[1] for row in rows],
                         ["2026-08-26 18:09:53", "2026-09-24 17:59:38"])

    def test_the_fonte_never_reaches_the_journal(self):
        rows = sync.rows_from([
            activity(identifier=1, sport="strength_training"),
            activity(identifier=2, sport="running"),
        ])

        self.assertEqual([row[0] for row in rows], ["2"])


if __name__ == "__main__":
    unittest.main()
