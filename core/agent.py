"""
The agent loop.

Model-agnostic ReAct: local GGUF models can't be trusted to emit native
function-calls reliably, so tools use a plain-text protocol every model
can follow — a fenced ```tool block containing JSON.

Two hard rules enforced here, not in the prompt:
  1. ALWAYS ASK. Any tool with side effects returns a pending-approval
     record instead of executing. The loop SUSPENDS and hands the
     approval request up to the UI. Nothing runs without your yes.
  2. Persistence. On failure the executor re-plans with escalating
     strategies rather than giving up after one try.
"""
import json
import re
import yaml
import time

from . import (config, memory, router, sandbox, skills, plugins, mcp, executor,
               toolparse, roles, policy, modes)
from .providers import ProviderError
from tools import fileops, devtools, firmware, checkpoint_tools

TOOL_RE = re.compile(r"```tool\s*\n(.*?)\n```", re.DOTALL)

# tools that change the world -> always routed through approval
SIDE_EFFECT_TOOLS = {"run_shell", "write_file", "apply_patch", "git", "gradle",
                     "npm", "adb", "fastboot", "cross_compile", "autotools_build",
                     "flash_partition", "delete_file", "restore_backup"}

READ_ONLY_TOOLS = {
    "read_file": lambda a: fileops.read_file(a["path"]),
    "list_dir": lambda a: fileops.list_dir(a.get("path", "."), a.get("depth", 2)),
    "diff_file": lambda a: fileops.diff_files(a["path"], a["content"]),
    "recall": lambda a: memory.recall(a.get("query", ""), project=a.get("project"),
                                      top_k=a.get("top_k", 8)),
    "remember": lambda a: {
        "stored": True,
        "id": memory.remember(a["content"], project=a.get("project", "general"),
                              kind=a.get("kind", "fact"), tags=a.get("tags", "")),
    },
    "load_skill": lambda a: skills.load_body(a["name"]),
    "list_skills": lambda a: [s["name"] for s in skills.load_all()],
    "command_history": lambda a: sandbox.history(a.get("n", 20)),
    "list_backups": lambda a: fileops.list_backups(),
}


def _persona():
    try:
        return yaml.safe_load(config.PERSONA_FILE.read_text())
    except Exception:  # noqa: BLE001
        return {"voice": "You are OMERTA, a coding and firmware agent.", "memory": {}}


CORE_TOOL_DOCS = """- run_shell(cmd) — run a shell command  [ASKS FIRST]
- read_file(path) / write_file(path, content)  [write ASKS FIRST]
- list_dir(path) — list a directory
- recall(query) / remember(content) — your long-term memory
- load_skill(name) — pull in a playbook (list_skills first)"""


def _tool_docs():
    if config.COMPACT:
        return CORE_TOOL_DOCS
    lines = [
        "run_shell(cmd, cwd) — run a shell command  [APPROVAL REQUIRED]",
        "read_file(path) — read a file",
        "write_file(path, content) — write a file  [APPROVAL REQUIRED]",
        "apply_patch(path, old, new) — targeted edit  [APPROVAL REQUIRED]",
        "diff_file(path, content) — preview a change without writing",
        "list_dir(path, depth) — list a directory",
        "git(args, cwd) / gradle(task, cwd) / npm(args, cwd)  [APPROVAL REQUIRED]",
        "adb(args) / fastboot(args)  [APPROVAL REQUIRED]",
        "cross_compile(source, target_arch, output)  [APPROVAL REQUIRED]",
        "recall(query, project) — search your long-term memory",
        "remember(content, kind, project) — store a durable fact",
        "load_skill(name) / list_skills() — pull in a skill's full playbook",
        "command_history(n) — what has actually been run",
        "list_backups() — snapshots taken before edits",
        "restore_backup(backup_path, dest) — undo a file change  [APPROVAL REQUIRED]",
    ]
    for name, d in plugins.tools().items():
        mark = "  [APPROVAL REQUIRED]" if d.get("side_effects") else ""
        lines.append(f"{name}({', '.join(d.get('args', {}))}) — {d.get('description','')}{mark}")
    for full, d in mcp.tools().items():
        lines.append(f"{full}(...) — {d['description'][:90]}  [APPROVAL REQUIRED]")
    return "\n".join(f"- {x}" for x in lines)


COMPACT_VOICE = ("You are OMERTA, a terse coding/firmware agent for an expert "
                 "Android/Termux developer. No preamble, no disclaimers. "
                 "Give complete commands, not fragments.")


def _share_across_projects():
    """Does recall include the shared `general` pool as well as this project?

    On unless OMERTA_STRICT_PROJECT is set. Strict is real isolation: nothing
    learned elsewhere reaches this conversation.
    """
    return not config.flag("OMERTA_STRICT_PROJECT")


def system_prompt(project, user_text=""):
    p = _persona()
    if config.COMPACT:
        # Minimal prompt for small local models. Keeps the approval contract
        # and the tools; drops persona prose, the skill catalog and most
        # recalled memory, which is what blows a 2-4k context on a phone.
        mem = memory.context_block(user_text, project=project,
                                   top_k=config.COMPACT_RECALL,
                                   shared=_share_across_projects())
        blocks = [COMPACT_VOICE, f"""TOOLS — to use one reply with ONLY:
```tool
{{"tool": "<name>", "args": {{...}}}}
```
{CORE_TOOL_DOCS}

Tools marked [ASKS FIRST] do NOT run when you call them — the user must
approve. On `status: awaiting_approval`, stop and say what you want to run
and why. If denied, do not retry it; propose something else.
Finished? Reply in plain text with no tool block."""]
        rb = roles.block()
        if rb:
            blocks.insert(1, rb)
        blocks.insert(1, modes.prompt_block())
        if mem:
            blocks.append(mem)
        return "\n\n".join(blocks)

    parts = [p.get("voice", "")]
    parts.append(modes.prompt_block())
    rb = roles.block()
    if rb:
        parts.append(rb)
    parts.append(f"""
TOOL PROTOCOL
To use a tool, reply with ONLY this and nothing else:
```tool
{{"tool": "<name>", "args": {{...}}}}
```
Available tools:
{_tool_docs()}

APPROVAL RULE (absolute)
Tools marked [APPROVAL REQUIRED] do not execute when you call them. The user
is shown your proposal and must approve it. When you get back
`status: awaiting_approval`, STOP and explain in plain language what you want
to run and why. Do not re-issue it, do not try a workaround to avoid asking,
do not batch several dangerous steps into one request. One step, one approval.

If a proposal is denied, do not retry the same thing. Propose a different
approach or ask what they'd prefer.

PERSISTENCE
Keep working until the task is genuinely done. If something fails, read the
actual error, form a new hypothesis, and try a different approach — up to a
few times. If you truly cannot proceed, say exactly what blocked you and what
you'd need. Never claim success you haven't verified.

When finished, reply in plain text with no tool block.
""".strip())

    mem = memory.context_block(user_text, project=project,
                               top_k=p.get("memory", {}).get("recall_top_k", 8),
                               shared=_share_across_projects())
    if mem:
        parts.append(mem)
    prefs = memory.preference_block(project=project,
                                    shared=_share_across_projects())
    if prefs:
        parts.append(prefs)
    cat = skills.catalog()
    if cat:
        parts.append(cat)
    sk = skills.active_block(user_text)
    if sk:
        parts.append(sk)
    return "\n\n".join(x for x in parts if x)


class Agent:
    def __init__(self, project="general"):
        self.project = project
        self.history = []
        self.pending = None          # an approval the loop is suspended on
        memory.init()
        plugins.load_all()

    # ── tool dispatch ────────────────────────────────────────────────────
    def _describe(self, call):
        """Render a tool call as the exact thing that will happen.
        For shell-backed tools this IS the command that will run — what you
        approve is character-for-character what executes."""
        t, a = call.get("tool"), call.get("args", {})
        if t == "run_shell":
            return a.get("cmd", "")
        if t == "git":
            return devtools.git_cmd(a.get("args", "status"))
        if t == "npm":
            return devtools.npm_cmd(a.get("args", "run build"))
        if t == "gradle":
            return devtools.gradle_cmd(a.get("task", "assembleDebug"), a.get("cwd", "."))
        if t == "adb":
            return devtools.adb_cmd(a.get("args", "devices"))
        if t == "fastboot":
            return devtools.fastboot_cmd(a.get("args", "devices"))
        if t == "cross_compile":
            return firmware.cross_compile_cmd(a["source"], a["target_arch"],
                                              a["output"], a.get("extra_flags", ""))
        if t == "autotools_build":
            return firmware.autotools_cross_cmd(a["project_dir"], a["host_triple"])
        if t == "flash_partition":
            return firmware.flash_cmd(a["image"], a["partition"])
        if t == "write_file":
            return f"write_file {a.get('path','')} ({len(a.get('content',''))} bytes)"
        if t == "delete_file":
            return f"delete_file {a.get('path','')}"
        if t == "restore_backup":
            return f"restore_backup {a.get('backup_path','')} -> {a.get('dest','')}"
        if t == "apply_patch":
            return f"apply_patch {a.get('path','')}"
        return f"{t}({json.dumps(a)[:160]})"

    # tools whose description IS a shell command -> single execution path
    SHELL_BACKED = {"run_shell", "git", "npm", "gradle", "adb", "fastboot",
                    "cross_compile", "autotools_build", "flash_partition"}

    def _known_tools(self):
        names = set(READ_ONLY_TOOLS) | SIDE_EFFECT_TOOLS | set(plugins.tools())
        names |= set(mcp.tools())
        return names

    def _needs_approval(self, name):
        if name in SIDE_EFFECT_TOOLS or name.startswith("mcp."):
            return True
        pdef = plugins.tools().get(name)
        return bool(pdef and pdef.get("side_effects"))

    def _execute_approved(self, call, command=None):
        """Runs a tool the user explicitly approved. Every shell-backed tool
        funnels through sandbox.run — one gate, one audit trail."""
        t, a = call.get("tool"), call.get("args", {})
        try:
            if t in self.SHELL_BACKED:
                cmd = command or self._describe(call)
                return sandbox.run(cmd, cwd=a.get("cwd", "."), project=self.project)
            if t == "write_file":
                return fileops.write_file(a["path"], a["content"])
            if t == "delete_file":
                return fileops.delete_file(a["path"])
            if t == "apply_patch":
                return fileops.apply_patch(a["path"], a["old"], a["new"])
            if t == "restore_backup":
                return fileops.restore_backup(a["backup_path"], a["dest"])
            if t.startswith("mcp."):
                return mcp.call(t, a)
            pdef = plugins.tools().get(t)
            if pdef:
                return pdef["fn"](a)
            return {"status": "error", "reason": f"unknown tool '{t}'"}
        except KeyError as e:
            return {"status": "error", "tool": t, "reason": f"missing arg {e}"}
        except Exception as e:  # noqa: BLE001
            return {"status": "error", "tool": t, "reason": str(e)}

    def _run_tool(self, call):
        name = call.get("tool")
        # A work mode is enforced here, not in the prompt. A model told to
        # "just plan" will start editing halfway through, because planning and
        # doing feel adjacent from the inside; the tool layer is what actually
        # stops it.
        if not modes.allows_tools():
            return {"status": "refused_by_mode", "mode": modes.current(),
                    "reason": modes.refusal(name)}
        if name not in READ_ONLY_TOOLS and not modes.allows_side_effects():
            if self._needs_approval(name):
                return {"status": "refused_by_mode", "mode": modes.current(),
                        "reason": modes.refusal(name)}
        if name in READ_ONLY_TOOLS:
            try:
                return {"status": "ok", "result": READ_ONLY_TOOLS[name](call.get("args", {}))}
            except Exception as e:  # noqa: BLE001
                return {"status": "error", "reason": str(e)}
        if self._needs_approval(name):
            desc = self._describe(call)
            if name in self.SHELL_BACKED:
                pre = sandbox.propose(desc, project=self.project)
                if pre["status"] == "denied_by_policy":
                    return pre
                danger, tier, hist = pre["danger"], pre["tier"], pre["history"]
            else:
                tier = policy.tier_for_tool(name)
                danger = tier == "HIGH_RISK"
                hist = memory.predict(desc, project=self.project)
            # The approval policy can spend the interruption budget where it
            # matters. It can never reach DENY or HIGH_RISK (see core/policy).
            if policy.auto_run(tier):
                out = self._execute_approved(call)
                out = dict(out or {})
                out["auto_run"] = True
                out["action"] = desc
                out["tier"] = tier
                out["policy"] = policy.current()
                # Not silent: turn() records {call, result} for every tool, so
                # the auto_run flag rides the result into the UI and the log,
                # and sandbox.run has already written the audit entry.
                return out
            self.pending = {"call": call, "description": desc}
            return {"status": "awaiting_approval", "action": desc, "tier": tier,
                    "danger": danger, "history": hist,
                    "note": "Suspended. The user must approve before this runs."}
        pdef = plugins.tools().get(name)
        if pdef:
            try:
                return {"status": "ok", "result": pdef["fn"](call.get("args", {}))}
            except Exception as e:  # noqa: BLE001
                return {"status": "error", "reason": str(e)}
        return {"status": "error", "reason": f"unknown tool '{name}'"}

    def _trim_history(self):
        """Bound the in-context history so conversations can run forever.

        Chats are unlimited; this only controls how much of the tail is replayed
        to the model each turn. Older turns are already distilled into long-term
        memory by _learn(), and memory.context_block() surfaces the relevant
        parts back into the system prompt, so trimming loses no durable state.
        """
        lim = config.HISTORY_LIMIT
        if lim and len(self.history) > lim:
            self.history = self.history[-lim:]
            # never begin the replayed window on a dangling assistant turn
            while self.history and self.history[0]["role"] != "user":
                self.history.pop(0)

    # ── main loop ────────────────────────────────────────────────────────
    def _loop(self, max_iters=None):
        self._trim_history()
        max_iters = max_iters or config.MAX_TOOL_ITERS
        tool_log = []
        last = {}
        tracker = executor.AttemptTracker(self.project)
        for _ in range(max_iters):
            sysmsg = system_prompt(self.project,
                                   self.history[-1]["content"] if self.history else "")
            try:
                r = router.complete(self.history, system=sysmsg)
            except ProviderError as e:
                return {"text": f"**No model available.**\n\n{e}", "provider": None,
                        "tool_log": tool_log, "pending": None}
            last = r
            text = r["text"]
            call = toolparse.parse(text)
            if not call:
                self.history.append({"role": "assistant", "content": text})
                self._learn(text)
                return {"text": text, "provider": r["provider"], "model": r["model"],
                        "offline": r["offline"], "tool_log": tool_log, "pending": None}
            if call["tool"] not in self._known_tools():
                self.history.append({"role": "assistant", "content": text})
                self.history.append({"role": "user", "content":
                                     f"[tool_result] no tool named '{call['tool']}'. "
                                     f"Available: {', '.join(sorted(self._known_tools())[:40])}"})
                continue

            res = self._run_tool(call)
            tool_log.append({"call": call, "result": res})
            self.history.append({"role": "assistant", "content": text})

            if executor.is_failure(res):
                # persistence: don't just hand the error back — tell the model
                # what it already tried, recall any known fix, and force a
                # genuinely different approach.
                tracker.record(res)
                self.history.append({"role": "user", "content":
                                     f"[tool_result] {json.dumps(res, default=str)[:3000]}\n"
                                     + tracker.guidance(res)})
            else:
                if res.get("status") == "ran" and res.get("returncode") == 0 and res.get("cmd"):
                    executor.record_success(res["cmd"], project=self.project)
                self.history.append({"role": "user",
                                     "content": f"[tool_result] {json.dumps(res, default=str)[:6000]}"})

            if res.get("status") == "awaiting_approval":
                return {"text": toolparse.strip_call(text),
                        "provider": r["provider"], "model": r["model"],
                        "offline": r["offline"], "tool_log": tool_log,
                        "pending": {"action": res["action"], "danger": res["danger"],
                                    "tier": res.get("tier"), "history": res.get("history")}}

        return {"text": "Hit the tool-iteration cap. Say `continue` to keep going.",
                "provider": last.get("provider"), "tool_log": tool_log, "pending": None}

    def turn(self, user_message):
        self.history.append({"role": "user", "content": user_message})
        return self._loop()

    # ── approval handling ────────────────────────────────────────────────
    def approve(self):
        """User said yes to the pending action. Execute it and resume."""
        if not self.pending:
            return {"text": "Nothing is waiting for approval.", "tool_log": [],
                    "pending": None}
        call = self.pending["call"]
        desc = self.pending["description"]
        self.pending = None
        result = self._execute_approved(call)
        memory.record_choice(desc, "approved", project=self.project)
        self.history.append({"role": "user",
                             "content": f"[approved+executed] {json.dumps(result, default=str)[:6000]}"})
        out = self._loop()
        out.setdefault("tool_log", []).insert(0, {"call": call, "result": result})
        return out

    def deny(self, note=""):
        """User said no. Record it so the agent learns, then resume."""
        if not self.pending:
            return {"text": "Nothing is waiting for approval.", "tool_log": [],
                    "pending": None}
        desc = self.pending["description"]
        self.pending = None
        sandbox.deny(desc, project=self.project, note=note)
        self.history.append({"role": "user", "content":
                             f"[denied by user] `{desc}` was refused."
                             f"{(' Reason: ' + note) if note else ''}"
                             " Do not retry it. Propose a different approach."})
        return self._loop()

    def edit_and_approve(self, new_cmd):
        """User rewrote the command — strong learning signal."""
        if not self.pending:
            return {"text": "Nothing is waiting for approval.", "tool_log": [], "pending": None}
        old = self.pending["description"]
        call = self.pending["call"]
        self.pending = None
        memory.record_choice(old, "edited", project=self.project, note=new_cmd)
        result = self._execute_approved(call, command=new_cmd)
        self.history.append({"role": "user", "content":
                             f"[user edited `{old}` to `{new_cmd}` and approved] "
                             f"{json.dumps(result, default=str)[:4000]}"})
        return self._loop()

    # ── learning ─────────────────────────────────────────────────────────
    def _learn(self, final_text):
        p = _persona()
        if not p.get("memory", {}).get("write_every_turn", True):
            return
        user_turns = [h["content"] for h in self.history if h["role"] == "user"
                      and not h["content"].startswith("[")]
        if not user_turns:
            return
        memory.remember(f"Asked: {user_turns[-1][:250]} | Outcome: {final_text[:350]}",
                        project=self.project, kind="session", weight=0.5)

    def reset(self):
        self.history, self.pending = [], None
