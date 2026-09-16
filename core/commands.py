"""
Top-level `omerta <verb>` subcommands beyond the core (serve/doctor/sync).

These realise the OMERTA AI command set on top of subsystems that already
exist — memory/learning, the repo importer/index, and the firmware plugin —
so there is no parallel implementation to drift. Every entry point routes
through dispatch() first; it returns an exit code when it handled the verb, or
None to let the interactive CLI take over.

Design rule (same as the agent): read-only by default, never guess, and never
claim success without evidence. Destructive device work is not exposed here —
it stays behind the agent's approval gate.
"""
import json
import sys

HANDLED = {"firmware", "teach", "learn", "memory", "forget", "rules",
           "index", "search", "symbol", "deps", "sandbox",
           "agent", "plan", "review", "build", "test", "debug", "role", "calls",
           "workflow", "git", "evidence"}


def _plugin_tool(name):
    from . import plugins
    plugins.load_all()
    t = plugins.tools().get(name)
    return t["fn"] if t else None


def _emit(obj):
    print(json.dumps(obj, indent=2, default=str) if not isinstance(obj, str) else obj)


# ── firmware ────────────────────────────────────────────────────────────────
def _firmware(argv):
    sub = argv[0] if argv else "help"
    rest = argv[1:]
    if sub == "inspect" and rest:
        fn = _plugin_tool("inspect_image")
        if not fn:
            print("firmware plugin not available"); return 1
        _emit(fn({"path": rest[0]}))
        return 0
    if sub in ("analyze", "dtb") and rest:
        fn = _plugin_tool("analyze_dtb")
        if not fn:
            print("firmware plugin not available"); return 1
        _emit(fn({"path": rest[0]}))
        return 0
    if sub in ("report", "board") and rest:
        fn = _plugin_tool("board_report")
        if not fn:
            print("firmware plugin not available"); return 1
        _emit(fn({"dir": rest[0]}))
        return 0
    if sub == "extract" and rest:
        fn = _plugin_tool("extract_image")
        _emit(fn({"path": rest[0], "out": rest[1] if len(rest) > 1 else ""}))
        return 0
    if sub == "repack" and rest:
        fn = _plugin_tool("repack_image")
        _emit(fn({"dir": rest[0], "out": rest[1] if len(rest) > 1 else ""}))
        return 0
    if sub == "super" and rest:
        # super <img>            -> list logical partitions
        # super <img> <out> [nm] -> extract to dir (optionally one partition)
        if len(rest) == 1:
            _emit(_plugin_tool("super_list")({"path": rest[0]}))
        else:
            _emit(_plugin_tool("super_extract")(
                {"path": rest[0], "out": rest[1],
                 "name": rest[2] if len(rest) > 2 else None}))
        return 0
    if sub == "superpack" and rest:
        _emit(_plugin_tool("super_repack")(
            {"dir": rest[0], "out": rest[1] if len(rest) > 1 else ""}))
        return 0
    if sub == "unsparse" and rest:
        _emit(_plugin_tool("unsparse_image")(
            {"path": rest[0], "out": rest[1] if len(rest) > 1 else ""}))
        return 0
    if sub == "plan":
        fn = _plugin_tool("collect_evidence_plan")
        _emit(fn({"out": rest[0]} if rest else {}))
        return 0
    print("usage: omerta firmware <inspect <img> | analyze <dtb|dtbo|boot.img> | "
          "extract <img> [out] | repack <dir> [out] | super <img> [out] | "
          "superpack <dir> [out] | unsparse <img> [out] | report <dir> | plan>")
    return 0


# ── learning / memory ────────────────────────────────────────────────────────
def _teach(argv):
    scope = "general"
    if argv and argv[0] == "--scope" and len(argv) > 1:
        scope, argv = argv[1], argv[2:]
    text = " ".join(argv).strip()
    if not text:
        print('usage: omerta teach [--scope <project>] "a durable project rule"')
        return 1
    from . import memory
    memory.remember(text, project=scope, kind="preference",
                    tags="taught", weight=2.0)
    print(f"learned (scope={scope}): {text}")
    return 0


def _memory(argv):
    from . import memory
    sub = argv[0] if argv else "show"
    if sub == "show":
        _emit(memory.stats())
        pb = memory.preference_block()
        if pb:
            print("\n" + pb)
        return 0
    if sub == "search":
        q = " ".join(argv[1:])
        hits = memory.recall(q, top_k=25)
        for h in hits:
            print(f"- ({h['kind']}) {h['content']}")
        if not hits:
            print("no matches")
        return 0
    print("usage: omerta memory <show|search \"query\">")
    return 0


def _forget(argv):
    q = " ".join(argv).strip()
    if not q:
        print('usage: omerta forget "text to match"'); return 1
    from . import memory
    hits = memory.recall(q, top_k=10)
    if not hits:
        print("nothing matched"); return 0
    for h in hits:
        memory.forget(h["id"])
    print(f"forgot {len(hits)} fact(s) matching: {q}")
    return 0


def _rules(argv):
    from . import memory
    project = argv[0] if argv else None
    pb = memory.preference_block(project=project)
    print(pb or "no learned rules yet — teach one with: omerta teach \"...\"")
    return 0


# ── code index / search / symbol / deps ──────────────────────────────────────
def _index(argv):
    from . import index
    path = argv[0] if argv else "."
    idx = index.build(path, save=True)
    print(f"indexed {idx['counts']['files']} files, "
          f"{idx['counts']['symbols']} symbols "
          f"({', '.join(f'{k}:{v}' for k, v in sorted(idx['languages'].items()))})")
    # also let the agent's memory learn the repo shape
    try:
        from tools import importers
        importers.auto(path, project="general")
    except Exception:  # noqa: BLE001
        pass
    return 0


def _search(argv):
    q = " ".join(argv).strip()
    if not q:
        print('usage: omerta search "symbol-or-file"'); return 1
    from . import index
    r = index.search(q)
    for s in r["symbols"]:
        print(f"  {s['file']}:{s['line']}  {s['kind']} {s['name']}")
    for f in r["files"]:
        print(f"  {f}")
    if not r["symbols"] and not r["files"]:
        print("no code matches. Run `omerta index` first, or try `omerta memory search`.")
    return 0


def _symbol(argv):
    name = " ".join(argv).strip()
    if not name:
        print('usage: omerta symbol "Name"'); return 1
    from . import index
    r = index.symbol(name)
    if not r["definitions"]:
        print(f"no definition of '{name}' found (run `omerta index` first)")
        return 0
    for s in r["definitions"]:
        print(f"  {s['file']}:{s['line']}  {s['kind']} {s['name']}")
    return 0


def _deps(argv):
    from . import index
    _emit(index.deps(argv[0] if argv else None))
    return 0


def _calls(argv):
    name = " ".join(argv).strip()
    if not name:
        print('usage: omerta calls "FunctionName"'); return 1
    from . import index
    _emit(index.calls(name))
    return 0


# ── sandbox (isolation + snapshots) ──────────────────────────────────────────
def _sandbox(argv):
    from . import isolate
    sub = argv[0] if argv else "status"
    rest = argv[1:]
    if sub == "status":
        _emit(isolate.status()); return 0
    if sub == "snapshot":
        _emit(isolate.snapshot(rest[0] if rest else ".",
                               note=" ".join(rest[1:]))); return 0
    if sub == "list":
        for s in isolate.list_snapshots():
            print(f"  {s['id']}  {s['files']} files  {s['src']}"
                  f"{('  · ' + s['note']) if s.get('note') else ''}")
        return 0
    if sub == "rollback":
        _emit(isolate.rollback(rest[0] if rest else "latest",
                               dest=rest[1] if len(rest) > 1 else None))
        return 0
    if sub == "wrap" and rest:
        print(isolate.wrap(" ".join(rest))); return 0
    print("usage: omerta sandbox <status | snapshot [dir] [note] | list | "
          "rollback [id] [dest] | wrap <cmd>>")
    return 0


# ── agent verbs (role-focused one-shots) ─────────────────────────────────────
import os


def _run_agent(task, role=None):
    """Run a one-shot agent turn under an optional role, reusing the terminal
    CLI so approvals work. Returns the CLI exit code."""
    if role:
        os.environ["OMERTA_ROLE"] = role
    import sys as _sys
    import cli
    _sys.argv = ["omerta", "-c", task]
    return cli.main()


def _agent(argv):
    task = " ".join(argv).strip()
    if not task:
        print('usage: omerta agent "task"'); return 1
    return _run_agent(task)


def _plan(argv):
    task = " ".join(argv).strip()
    if not task:
        print('usage: omerta plan "what to build/change"'); return 1
    return _run_agent("Produce a staged implementation plan (do not modify "
                      "anything): " + task, role="architect")


def _review(argv):
    target = " ".join(argv).strip() or "the current uncommitted changes (git diff)"
    return _run_agent(f"Review {target} for correctness, safety and style. "
                      "Report findings by severity with file:line. Do not modify files.",
                      role="reviewer")


def _build(argv):
    extra = " ".join(argv).strip()
    return _run_agent("Discover this project's build system and build it"
                      + (f" ({extra})" if extra else "")
                      + ". Report the result with the actual build output.",
                      role="builder")


def _test(argv):
    extra = " ".join(argv).strip()
    return _run_agent("Find and run this project's tests"
                      + (f" ({extra})" if extra else "")
                      + ". Report pass/fail with the actual output.", role="tester")


def _debug(argv):
    err = " ".join(argv).strip()
    if not err:
        print('usage: omerta debug "error text"'); return 1
    return _run_agent("Debug this failure: find the root cause (file:line), "
                      "propose a fix, and verify it.\n\n" + err, role="debugger")


def _workflow(argv):
    from . import orchestrator
    known = set(orchestrator.PIPELINES) | set(orchestrator.PARALLEL_PIPELINES)
    if not argv:
        seq = ", ".join(sorted(orchestrator.PIPELINES))
        par = ", ".join(sorted(orchestrator.PARALLEL_PIPELINES))
        print(f"usage: omerta workflow [pipeline] \"task\"\n"
              f"sequential: {seq}\nparallel:   {par}")
        return 1
    if argv[0] in known:
        pipeline, task = argv[0], " ".join(argv[1:]).strip()
    else:
        pipeline, task = "default", " ".join(argv).strip()
    if not task:
        print("give a task"); return 1
    res = orchestrator.run(task, pipeline=pipeline)
    if res.get("status") != "ok":
        _emit(res); return 1
    for st in res["transcript"]:
        print(f"\n=== [{st['role']}] ({st.get('provider') or '?'}) ===")
        print(st["text"] or "(no output)")
        if st.get("pending"):
            print(f"  ⚠ pending approval: {st['pending'].get('action')}")
            print(f"  {st.get('stopped', '')}")
    return 0


def _evidence(argv):
    from . import evidence
    sub = argv[0] if argv else "show"
    rest = argv[1:]
    if sub == "add":
        # omerta evidence add <CONFIDENCE> "value" ["source"]
        if len(rest) < 2:
            print('usage: omerta evidence add <CONFIRMED|LIKELY|INFERRED|UNKNOWN> '
                  '"claim" ["source"]')
            return 1
        conf, value = rest[0], rest[1]
        source = rest[2] if len(rest) > 2 else ""
        _emit(evidence.note(value, conf, source=source))
        return 0
    if sub in ("show", "log"):
        _emit(evidence.log(project=rest[0] if rest else None))
        return 0
    print("usage: omerta evidence <add <conf> \"claim\" [\"source\"] | show>")
    return 0


def _git(argv):
    from . import gitx
    sub = argv[0] if argv else "status"
    rest = argv[1:]
    fns = {"status": gitx.status, "diff": gitx.diff, "log": gitx.log,
           "branch": gitx.branches, "branches": gitx.branches,
           "show": gitx.show, "review": gitx.review}
    if sub not in fns:
        print("usage: omerta git <status|diff|log|branch|show <ref>|review>\n"
              "(mutating git — commit/reset/push — goes through the agent's gate)")
        return 1
    a = {}
    if sub == "show" and rest:
        a["ref"] = rest[0]
    if sub == "diff" and rest and rest[0] in ("--staged", "staged"):
        a["staged"] = True
    try:
        _emit(fns[sub](a))
    except Exception as e:  # noqa: BLE001
        print(f"git error: {e}"); return 1
    return 0


def _role(argv):
    from . import roles, config
    if not argv:
        cur = config.get("OMERTA_ROLE", "") or "(none)"
        print(f"current role: {cur}\navailable: {', '.join(roles.names())}")
        return 0
    r = roles.resolve(argv[0])
    if r not in roles.ROLES and argv[0] != "none":
        print(f"unknown role '{argv[0]}'. available: {', '.join(roles.names())}")
        return 1
    config.set_setting("OMERTA_ROLE", "" if argv[0] == "none" else r)
    print(f"role set to: {r if argv[0] != 'none' else '(none)'}")
    return 0


def dispatch(argv):
    """Handle a top-level verb. Returns an int exit code, or None if the verb
    isn't one of ours (let the interactive CLI handle it)."""
    if not argv:
        return None
    verb, rest = argv[0], argv[1:]
    if verb not in HANDLED:
        return None
    return {
        "firmware": _firmware,
        "teach": _teach,
        "learn": _teach,
        "memory": _memory,
        "forget": _forget,
        "rules": _rules,
        "index": _index,
        "search": _search,
        "symbol": _symbol,
        "deps": _deps,
        "sandbox": _sandbox,
        "calls": _calls,
        "agent": _agent,
        "plan": _plan,
        "review": _review,
        "build": _build,
        "test": _test,
        "debug": _debug,
        "role": _role,
        "workflow": _workflow,
        "git": _git,
        "evidence": _evidence,
    }[verb](rest)
