#!/usr/bin/env python3
"""Tests de `mfp_sync.py`. Bibliothèque standard seule, comme lui.

    cd grafana && python3 -m unittest test_mfp_sync -v

Seule la conversion est testée : le reste du script parle à MyFitnessPal par
le réseau, comme `garmin_sync.py` parle à Garmin. C'est pourtant ici que se
cache le vrai risque — MyFitnessPal rend les macros dans un ordre, le journal
les attend dans un autre.
"""

import os
import tempfile
import unittest

import mfp_sync


def entry(meal="Lunch", name="Oeufs", calories=540, protein=39, carbs=2, fat=42):
    return {"meal": meal, "name": name, "calories": calories,
            "protein": protein, "carbs": carbs, "fat": fat}


class JournalRow(unittest.TestCase):
    def test_the_macros_are_written_in_the_journal_order_not_myfitnesspal_s(self):
        row = mfp_sync.journal_row("2026-09-20", entry())

        # Le journal attend kcal, protéines, LIPIDES, GLUCIDES ; MyFitnessPal
        # rend protéines, glucides, lipides. Six œufs, c'est 42 g de lipides
        # et 2 g de glucides — jamais l'inverse.
        self.assertEqual(row[4:], ["540", "39", "42", "2"])

    def test_each_meal_lands_on_its_french_name_and_its_hour(self):
        for meal, expected in [("Breakfast", ("matin", "08:00")),
                               ("Lunch", ("midi", "12:30")),
                               ("Dinner", ("soir", "20:00")),
                               ("Snacks", ("collation", "16:00"))]:
            with self.subTest(meal=meal):
                row = mfp_sync.journal_row("2026-09-20", entry(meal=meal))
                self.assertEqual((row[2], row[1]), expected)

    def test_the_day_and_the_food_name_are_kept_as_they_are(self):
        row = mfp_sync.journal_row("2026-09-20", entry(name="Pomme Pink Lady, 180 gram(s)"))

        self.assertEqual(row[0], "2026-09-20")
        self.assertEqual(row[3], "Pomme Pink Lady, 180 gram(s)")

    def test_a_macro_myfitnesspal_does_not_know_stays_empty(self):
        row = mfp_sync.journal_row("2026-09-20", entry(protein=None))

        # Une macro absente n'est pas une macro nulle : le chargeur la lit
        # comme inconnue, et le total du jour devient une borne basse.
        self.assertEqual(row[5], "")

    def test_an_unknown_meal_name_stops_the_script(self):
        # MyFitnessPal laisse renommer ses repas : plutôt que de deviner ou de
        # perdre la ligne en silence, on s'arrête en nommant le repas.
        with self.assertRaises(SystemExit):
            mfp_sync.journal_row("2026-09-20", entry(meal="Brunch"))


class Merge(unittest.TestCase):
    """Le script ne voit qu'une fenêtre de jours. Ce qu'il n'a pas regardé, il
    ne doit pas l'effacer : sinon une fenêtre plus courte perdrait l'histoire."""

    def test_a_day_the_script_did_not_look_at_keeps_its_rows(self):
        ancien = [["2026-01-05", "12:30", "midi", "Riz", "400", "8", "2", "90"]]
        neuf = [["2026-09-20", "12:30", "midi", "Oeufs", "540", "39", "42", "2"]]

        self.assertEqual(mfp_sync.merged(ancien, neuf), ancien + neuf)

    def test_a_day_looked_at_again_is_replaced_not_added_to(self):
        ancien = [["2026-09-20", "12:30", "midi", "Oeufs", "540", "39", "42", "2"]]
        neuf = [["2026-09-20", "12:30", "midi", "Oeufs", "540", "39", "42", "2"],
                ["2026-09-20", "20:00", "soir", "Riz", "400", "8", "2", "90"]]

        # Sinon les œufs compteraient deux fois à chaque passage du script.
        self.assertEqual(mfp_sync.merged(ancien, neuf), neuf)

    def test_the_journal_comes_out_in_order(self):
        ancien = [["2026-09-20", "20:00", "soir", "Riz", "400", "8", "2", "90"]]
        neuf = [["2026-01-05", "12:30", "midi", "Pain", "250", "8", "1", "50"]]

        self.assertEqual([row[0] for row in mfp_sync.merged(ancien, neuf)],
                         ["2026-01-05", "2026-09-20"])


# Un serveur MCP de comédie : il répond, mais glisse d'abord une ligne de
# journal, comme le vrai (`notifications/message` sur la sortie standard).
FAUX_SERVEUR = """#!/usr/bin/env python3
import json, sys

for line in sys.stdin:
    message = json.loads(line)
    if message.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": {}}), flush=True)
    elif message.get("method") == "tools/call":
        print(json.dumps({"jsonrpc": "2.0", "method": "notifications/message",
                          "params": {"level": "info", "data": "je bavarde"}}), flush=True)
        contenu = [{"type": "text", "text": '{"jour": "2026-09-20"}'}]
        print(json.dumps({"jsonrpc": "2.0", "id": message["id"],
                          "result": {"content": contenu}}), flush=True)
"""


class TalkingToTheServer(unittest.TestCase):
    def test_a_log_line_before_the_answer_is_not_mistaken_for_it(self):
        with tempfile.TemporaryDirectory() as directory:
            faux = os.path.join(directory, "faux_serveur.py")
            with open(faux, "w", encoding="utf-8") as handle:
                handle.write(FAUX_SERVEUR)
            os.chmod(faux, 0o755)

            with mfp_sync.Server(faux, 30) as server:
                answer = server.call("fitness_get_day", {"date": "2026-09-20"})

        self.assertEqual(answer, {"jour": "2026-09-20"})


if __name__ == "__main__":
    unittest.main()
