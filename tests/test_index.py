"""Codebase index: accurate Python symbols/imports + multi-language regex."""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core import index  # noqa: E402


def test_python_symbols_and_imports():
    d = tempfile.mkdtemp()
    open(os.path.join(d, "mod.py"), "w").write(
        "import os\nfrom collections import OrderedDict\n\n"
        "class Widget:\n    def spin(self):\n        return 1\n\n"
        "def helper(x):\n    return x\n")
    open(os.path.join(d, "app.go"), "w").write(
        "package main\nfunc Serve() {}\ntype Server struct {}\n")
    idx = index.build(d, save=True)
    names = {(s["kind"], s["name"]) for s in idx["symbols"]}
    assert ("class", "Widget") in names
    assert ("method", "Widget.spin") in names
    assert ("function", "helper") in names
    assert ("func", "Serve") in names and ("type", "Server") in names
    assert "os" in idx["deps"]["mod.py"] and "collections" in idx["deps"]["mod.py"]

    assert index.symbol("spin", root=d)["definitions"][0]["line"] == 5
    s = index.search("Widget", root=d)
    assert any(x["name"] == "Widget" for x in s["symbols"])
    dp = index.deps(root=d)
    assert dp["files_with_imports"] >= 1
    print("  ✓ python ast symbols+imports and go regex symbols indexed")


def test_cache_roundtrip():
    d = tempfile.mkdtemp()
    open(os.path.join(d, "a.py"), "w").write("def a():\n    pass\n")
    index.build(d, save=True)
    loaded = index.load(d)
    assert loaded and loaded["counts"]["symbols"] == 1
    print("  ✓ index cached to disk and reloaded")


def test_self_index():
    idx = index.build(ROOT, save=False)
    # this repo has agent.py, httpd.py, etc. — sanity that we found real symbols
    assert idx["counts"]["files"] > 10 and idx["counts"]["symbols"] > 50
    assert any(s["name"] == "Agent" and s["kind"] == "class" for s in idx["symbols"])
    print(f"  ✓ self-index: {idx['counts']['files']} files, "
          f"{idx['counts']['symbols']} symbols, found class Agent")


def test_call_graph():
    d = tempfile.mkdtemp()
    open(os.path.join(d, "m.py"), "w").write(
        "def helper():\n    return 1\n\n"
        "def main():\n    helper()\n    print('go')\n")
    idx = index.build(d, save=True)
    assert idx["counts"]["call_edges"] >= 2, idx["counts"]
    c = index.calls("main", root=d)
    assert "helper" in [x for e in c["defines_calls_to"] for x in e["callees"]]
    who = index.calls("helper", root=d)
    assert any(e["caller"] == "main" for e in who["called_by"]), who
    print("  ✓ call graph: main→helper edge and helper←main caller found")


if __name__ == "__main__":
    test_python_symbols_and_imports()
    test_cache_roundtrip()
    test_call_graph()
    test_self_index()
    print("\nINDEX TESTS PASSED")
