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


class BackupRestoreTest(unittest.TestCase):
    def test_backup_all_and_restore(self):
        import tempfile, os as _os
        lib = d.BrainLibrary(tempfile.mkdtemp())
        lib.respond("remember that alpha is one")
        lib.create("Second"); lib.respond("remember that beta is two")
        n_before = len(lib.list())
        bak = _os.path.join(lib.dir, "all.zip")
        self.assertEqual(lib.backup_all(bak), n_before)
        # fresh library, restore
        lib2 = d.BrainLibrary(tempfile.mkdtemp())
        restored = lib2.restore_all(bak)
        self.assertEqual(restored, n_before)
        ids = {b["id"] for b in lib2.list()}
        self.assertTrue({"omerta", "second"}.issubset(ids) or n_before <= len(ids))

    def test_corrupt_brain_falls_back_to_bak(self):
        import tempfile, os as _os
        lib = d.BrainLibrary(tempfile.mkdtemp())
        p = lib.path_for(lib.brain["id"])
        lib.respond("remember that gamma is three")   # writes .bak of the seed
        lib.respond("remember that delta is four")     # .bak now has gamma
        with open(p, "w") as f:
            f.write("{ this is corrupt json ]")
        b = ob.load(p)                                  # should recover from .bak
        self.assertEqual(b["format"], "omerta-brain/1")
