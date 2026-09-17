"""
Editor, scratch sandboxes, and themes.

The claims worth pinning down, because each one is load-bearing:

  * the editor cannot read or write outside its declared roots, including via
    a symlink that points out
  * a save is a PROPOSAL — nothing reaches disk until it is committed
  * a scratch sandbox runs real code and the project tree does not change
    until you accept, and a partial accept takes only what was chosen
  * a theme cannot smuggle CSS through a colour, and an uploaded "image" is
    validated by its bytes rather than its filename
"""
import base64
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault("OMERTA_DATA_DIR", tempfile.mkdtemp())

from core import workspace, scratch, theme, isolate  # noqa: E402

ok = True


def check(label, cond):
    global ok
    ok = ok and bool(cond)
    print(f"  {'✓' if cond else '✗'} {label}")


def _project():
    p = tempfile.mkdtemp()
    os.makedirs(os.path.join(p, "src"))
    open(os.path.join(p, "src", "app.py"), "w").write("def main():\n    return 1\n")
    open(os.path.join(p, "README.md"), "w").write("# demo\n")
    open(os.path.join(p, "keep.txt"), "w").write("untouched\n")
    return p


def test_editor_containment():
    proj = _project()
    os.environ["OMERTA_WORKSPACE_ROOTS"] = proj
    check("browsing is confined to the declared root",
          workspace.roots() == [os.path.realpath(proj)])
    check("a file inside the root reads",
          workspace.read({"path": os.path.join(proj, "README.md")})["status"] == "ok")
    for bad in ("/etc/passwd", os.path.join(proj, "..", "..", "etc", "passwd"),
                "~/.ssh/id_rsa"):
        check(f"refused outside the root: {bad}",
              workspace.read({"path": bad})["status"] == "error")

    # a symlink is caught by where it LANDS, not how it is spelled
    link = os.path.join(proj, "escape")
    os.symlink("/etc/passwd", link)
    r = workspace.read({"path": link})
    check("a symlink pointing out of the root is refused",
          r["status"] == "error" and "outside" in r["reason"])
    os.remove(link)

    check("the tree skips build junk",
          not any(e["name"] in workspace.SKIP_DIRS
                  for e in workspace.tree({"path": proj})["entries"]))


def test_save_is_a_proposal():
    proj = _project()
    os.environ["OMERTA_WORKSPACE_ROOTS"] = proj
    target = os.path.join(proj, "src", "app.py")
    before = open(target).read()

    pr = workspace.propose_save({"path": target, "content": "def main():\n    return 2\n"})
    check("a save proposes rather than writes",
          pr["status"] == "awaiting_approval")
    check("...and the file on disk is untouched", open(target).read() == before)
    check("...and the proposal shows a real diff",
          "+    return 2" in pr["diff"] and "-    return 1" in pr["diff"])

    check("an identical save is reported as unchanged",
          workspace.propose_save({"path": target, "content": before})["status"]
          == "unchanged")

    res = workspace.commit_save({"path": target, "content": "def main():\n    return 2\n"})
    check("committing writes", res["status"] == "ok"
          and open(target).read().strip().endswith("return 2"))
    check("the previous version is archived",
          workspace.backups()["count"] >= 1)


def test_scratch_isolates_then_accepts():
    proj = _project()
    s = scratch.create({"source": proj, "name": "t"})
    check("a sandbox is created from the project", s["status"] == "ok")
    sid = s["id"]
    check("it starts identical to the project",
          scratch.changes({"id": sid})["clean"])

    # do real work in there: edit, add, delete
    open(os.path.join(s["path"], "src", "app.py"), "w").write("def main():\n    return 42\n")
    open(os.path.join(s["path"], "NEW.md"), "w").write("new\n")
    os.remove(os.path.join(s["path"], "README.md"))

    r = scratch.run({"id": sid, "cmd": "python3 -c \"import src.app as a; print(a.main())\""})
    check("code actually runs inside the sandbox",
          r.get("status") == "ran" and "42" in (r.get("stdout") or ""))

    ch = scratch.changes({"id": sid})
    check("changes are tracked (+1 ~1 -1)",
          (ch["added"], ch["modified"], ch["removed"]) == (1, 1, 1))
    check("THE PROJECT IS UNTOUCHED",
          open(os.path.join(proj, "src", "app.py")).read().strip().endswith("return 1")
          and os.path.isfile(os.path.join(proj, "README.md"))
          and not os.path.exists(os.path.join(proj, "NEW.md")))

    pr = scratch.propose_accept({"id": sid})
    check("accepting proposes first", pr["status"] == "awaiting_approval")
    check("...and still writes nothing",
          open(os.path.join(proj, "src", "app.py")).read().strip().endswith("return 1"))

    scratch.accept({"id": sid, "paths": ["src/app.py"]})
    check("a partial accept takes only what was chosen",
          open(os.path.join(proj, "src", "app.py")).read().strip().endswith("return 42")
          and not os.path.exists(os.path.join(proj, "NEW.md"))
          and os.path.isfile(os.path.join(proj, "README.md")))
    check("the rest is still listed as outstanding",
          {c["path"] for c in scratch.changes({"id": sid})["changes"]}
          == {"NEW.md", "README.md"})

    scratch.accept({"id": sid})
    check("accepting the rest applies adds and deletes",
          os.path.exists(os.path.join(proj, "NEW.md"))
          and not os.path.exists(os.path.join(proj, "README.md")))
    check("a file nobody touched is left alone",
          open(os.path.join(proj, "keep.txt")).read().strip() == "untouched")

    check("discarding removes the sandbox",
          scratch.discard({"id": sid})["status"] == "ok")

    # discarding an untouched-project sandbox must leave the project alone
    proj2 = _project()
    s2 = scratch.create({"source": proj2})
    open(os.path.join(s2["path"], "src", "app.py"), "w").write("RUINED\n")
    scratch.discard({"id": s2["id"]})
    check("a discarded experiment never reaches the project",
          open(os.path.join(proj2, "src", "app.py")).read().strip().endswith("return 1"))


def test_sandbox_contains_the_device():
    """The sandbox protects the DEVICE, not just the project.

    Skipped honestly where the platform cannot do it (an unrooted Android app
    has no namespaces), because a test that quietly passes by doing nothing is
    how you end up trusting containment you never had.
    """
    caps = isolate.capabilities(refresh=True)
    print(f"  · containment available here: {caps['best']} ({caps['reason']})")

    # a secret on the host that the sandbox must not be able to read
    secret = os.path.join(os.path.expanduser("~"), ".omerta_test_secret")
    with open(secret, "w") as f:
        f.write("TOP-SECRET-HOST-FILE\n")
    os.environ["OMERTA_TEST_API_KEY"] = "sk-ant-must-not-leak"

    proj = _project()
    s = scratch.create({"source": proj, "name": "contained"})
    sid = s["id"]
    try:
        r = scratch.run({"id": sid, "cmd": "python3 -c \"print(6*7)\""})
        check("real code still runs inside the sandbox",
              "42" in (r.get("stdout") or ""))
        lvl = r["isolation"]["level"]
        check(f"the level achieved is reported honestly ({lvl})",
              lvl in ("strict", "relaxed", "limits"))

        if lvl == "limits":
            check("no namespaces here, and it says so rather than pretending",
                  "note" in r["isolation"])
            return

        env = scratch.run({"id": sid, "cmd": "env"}).get("stdout") or ""
        check("API keys are NOT visible inside the sandbox",
              "must-not-leak" not in env and "OMERTA_TEST_API_KEY" not in env)

        net = scratch.run({"id": sid, "cmd":
                           "python3 -c \"import socket;"
                           "socket.create_connection(('1.1.1.1',53),timeout=3);"
                           "print('REACHED')\" 2>&1 | tail -1"})
        check("the network is unreachable by default",
              "REACHED" not in (net.get("stdout") or ""))

        if lvl == "strict":
            home = scratch.run({"id": sid, "cmd":
                                f"cat {secret} 2>&1 | head -1"})
            check("a host file in ~ cannot be read",
                  "TOP-SECRET-HOST-FILE" not in (home.get("stdout") or ""))
            root = scratch.run({"id": sid, "cmd": "ls / | tr '\\n' ' '"})
            listing = (root.get("stdout") or "")
            check("the home directory is not even present",
                  " home " not in f" {listing} " and "root" not in listing.split())
            pids = scratch.run({"id": sid, "cmd":
                                "ls /proc | grep -c '^[0-9]*$'"})
            try:
                seen = int((pids.get("stdout") or "0").strip() or 0)
            except ValueError:
                seen = 999
            check(f"other processes are invisible ({seen} pids in the sandbox)",
                  seen < 20)

        # and the host is untouched by all of that
        check("the host filesystem is unchanged",
              open(secret).read().strip() == "TOP-SECRET-HOST-FILE"
              and not os.path.exists("/etc/EVIL"))
    finally:
        scratch.discard({"id": sid})
        os.remove(secret)
        os.environ.pop("OMERTA_TEST_API_KEY", None)


def test_isolation_never_overclaims():
    caps = isolate.capabilities(refresh=True)
    # asking for more than the device can do must degrade, not lie
    j = isolate.jail("true", workdir=tempfile.mkdtemp(), level="strict")
    order = {"limits": 0, "relaxed": 1, "strict": 2}
    check("a requested level is capped by what the device can enforce",
          order[j["level"]] <= order[caps["best"]])
    j2 = isolate.jail("true", workdir=tempfile.mkdtemp(), level="limits")
    check("asking for less is honoured", j2["level"] == "limits")
    check("network is denied unless explicitly asked for", j["net"] is False)
    check("secret-looking variables are stripped from a sandbox environment",
          not any(k in isolate.safe_env({"AWS_SECRET_ACCESS_KEY": "x",
                                         "GH_TOKEN": "y", "PATH": "/bin"})
                  for k in ("AWS_SECRET_ACCESS_KEY", "GH_TOKEN")))


def test_theme_cannot_inject():
    r = theme.save({"name": "probe", "from": "omerta", "colors": {
        "accent": "red; } body { display:none",      # CSS escape attempt
        "bg": "javascript:alert(1)",
        "evil": "#000000",                            # unknown token
        "accent_bright": "#00ff88",                   # the one good value
    }})
    check("a colour that is not a colour is rejected",
          "accent" in r["rejected"] and "bg" in r["rejected"])
    check("an unknown token is rejected", "evil" in r["rejected"])
    check("the valid colour is applied",
          r["theme"]["colors"]["accent_bright"] == "#00ff88")
    css = theme.css("probe")
    check("no injected CSS reaches the stylesheet",
          "display:none" not in css and "javascript:" not in css)

    theme.save({"name": "probe", "ui_font": "Fake; } * { color:red"})
    check("a font stack cannot close the rule",
          "}" not in theme.resolve("probe")["ui_font"]
          and ";" not in theme.resolve("probe")["ui_font"])

    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQ"
        "GAhKmMIQAAAABJRU5ErkJggg==")
    check("a real PNG is accepted",
          theme.put_image({"name": "probe", "slot": "logo",
                           "content_b64": base64.b64encode(png).decode()})
          ["status"] == "ok")
    check("HTML named .png is refused (bytes, not filename)",
          theme.put_image({"name": "probe", "slot": "crest", "content_b64":
                           base64.b64encode(b"<html><script>alert(1)</script>")
                           .decode()})["status"] == "error")
    check("SVG is refused — it can carry script",
          theme.put_image({"name": "probe", "slot": "crest", "content_b64":
                           base64.b64encode(b'<svg xmlns="http://www.w3.org/'
                                            b'2000/svg"><script/></svg>')
                           .decode()})["status"] == "error")
    check("a theme asset path cannot escape the asset directory",
          theme.image_path("../../../etc/passwd") is None)
    check("built-in themes cannot be deleted",
          theme.delete("omerta")["status"] == "error")
    check("editing a built-in forks it instead of breaking the fallback",
          theme.save({"name": "omerta", "colors": {"accent": "#111111"}})["name"]
          != "omerta")
    theme.delete("probe")
    check("a deleted theme falls back to the built-in",
          theme.use("omerta")["active"] == "omerta")


if __name__ == "__main__":
    test_editor_containment()
    test_save_is_a_proposal()
    test_scratch_isolates_then_accepts()
    test_sandbox_contains_the_device()
    test_isolation_never_overclaims()
    test_theme_cannot_inject()
    print("\n" + ("WORKSPACE TESTS PASSED" if ok else "WORKSPACE TESTS FAILED"))
    sys.exit(0 if ok else 1)
