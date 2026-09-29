"""Headless tests for the desktop app's library layer: python3 -m unittest desktop/test_desktop.py"""
import os, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "..", "brain"))
import omerta_desktop as d  # noqa: E402
import omerta_brain as ob   # noqa: E402


class DesktopLibraryTest(unittest.TestCase):
    def setUp(self):
        self.lib = d.BrainLibrary(tempfile.mkdtemp())

    def test_seed_and_chat(self):
        self.assertEqual(self.lib.brain["format"], "omerta-brain/1")
        self.assertTrue(self.lib.list())
        self.assertIn("9981", (self.lib.respond("remember that the code is 9981"),
                               self.lib.respond("what is the code"))[1])

    def test_reflex_and_files(self):
        self.lib.create("Blank")
        self.lib.respond("when I say ping, say pong")
        self.assertEqual(self.lib.respond("ping"), "pong")
        doc = os.path.join(self.lib.dir, "n.md")
        open(doc, "w").write("The reactor limit is 340 kelvin.")
        self.assertGreaterEqual(self.lib.teach_files([doc]), 1)
        self.assertIn("340", self.lib.respond("what is the reactor limit"))

    def test_switch_export_delete(self):
        a = self.lib.brain["id"]
        self.lib.create("Second")
        self.assertGreaterEqual(len(self.lib.list()), 2)
        out = os.path.join(self.lib.dir, "e.brain"); self.lib.export(out)
        self.assertEqual(ob.load(out)["name"], "Second")
        self.lib.switch_to(a)
        self.assertEqual(self.lib.brain["id"], a)
        self.lib.delete_active()
        self.assertTrue(self.lib.list())

    def test_selftest_entrypoint(self):
        self.assertEqual(d.selftest(), 0)


if __name__ == "__main__":
    unittest.main()
