"""Tests for Brain Studio: python3 -m unittest brain/test_omerta_brain.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import omerta_brain as ob  # noqa: E402


class BrainStudioTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "t.brain")

    def run_cli(self, *args):
        ob.main(list(args))

    def test_new_teach_chat(self):
        self.run_cli("new", "Nova", "--tone", "playful", "-o", self.path)
        self.run_cli("teach", self.path, "the vault code is 9981")
        self.run_cli("reply", self.path, "ping", "pong")
        self.run_cli("rule", self.path, "Always be brief")
        b = ob.load(self.path)
        self.assertEqual(b["format"], "omerta-brain/1")
        self.assertEqual(b["persona"]["tone"], "playful")
        e = ob.Engine(b)
        self.assertIn("9981", e.respond("what is the vault code"))
        self.assertEqual(e.respond("ping"), "pong")

    def test_correction(self):
        e = ob.Engine(ob.blank("X"))
        e.respond("remember that the party is on friday")
        e.respond("when is the party")
        e.respond("wrong, it's on saturday")
        self.assertIn("saturday", e.respond("when is the party"))

    def test_build_bundled_sources(self):
        for name in ("omerta", "luna", "sensei"):
            b = ob.build_from_folder(os.path.join(HERE, "sources", name))
            self.assertEqual(b["id"], name)
            self.assertTrue(b["persona"]["greeting"])
        omerta = ob.build_from_folder(os.path.join(HERE, "sources", "omerta"))
        self.assertGreater(len(omerta["knowledge"]), 20)

    def test_docs_chunking(self):
        text = "\n\n".join(f"Paragraph {i} " + "word " * 60 for i in range(20))
        chunks = ob.chunk(text)
        self.assertGreater(len(chunks), 3)
        self.assertTrue(all(len(c) <= 800 for c in chunks))

    def test_merge_and_validate(self):
        a = os.path.join(self.tmp, "a.brain"); b = os.path.join(self.tmp, "b.brain")
        self.run_cli("new", "A", "-o", a); self.run_cli("teach", a, "alpha is first")
        self.run_cli("new", "B", "-o", b); self.run_cli("teach", b, "beta is second")
        out = os.path.join(self.tmp, "ab.brain")
        self.run_cli("merge", a, b, "-o", out)
        self.assertEqual(len(ob.load(out)["knowledge"]), 2)
        r = subprocess.run([sys.executable, os.path.join(HERE, "omerta_brain.py"), "validate", out])
        self.assertEqual(r.returncode, 0)

    def test_app_asset_matches_source_shape(self):
        asset = os.path.join(HERE, "..", "android", "app", "src", "main", "assets", "brains", "omerta.brain")
        with open(asset, encoding="utf-8") as f:
            b = json.load(f)
        self.assertEqual(b["format"], "omerta-brain/1")
        for key in ("persona", "knowledge", "reflexes", "lessons", "profile", "stats"):
            self.assertIn(key, b)


if __name__ == "__main__":
    unittest.main()


class DedupeTest(unittest.TestCase):
    def test_add_fact_dedupes(self):
        b = ob.blank("X")
        ob.add_fact(b, "The gate code is 4471")
        n = len(b["knowledge"])
        ob.add_fact(b, "the gate code is 4471.")
        self.assertEqual(n, len(b["knowledge"]))
