#!/usr/bin/env python3
"""
Omerta AI — native Linux desktop app (offline brain).

A real native-window GUI (Tkinter/Tk — no browser, no web view) for the same offline,
teachable brain the Android app runs. Everything is in the executable: there is no server
to start and no terminal backend. It works with zero network.

  - Chat with your brain offline; teach it by talking ("remember that…", "when I say X,
    say Y", "wrong, it's…", "forget…").
  - Give it a personality (name, tone, greeting, traits, catchphrases…).
  - Load files (.txt/.md/.csv/.html) to teach it; import/export portable .brain files;
    keep several brains and switch between them.

Brains live in ~/.local/share/omerta-ai/brains/. The brain engine is shared with
Brain Studio (omerta_brain.py), so brains move between desktop, PC and phone unchanged.

Run:  omerta-ai         (installed)   |   python3 omerta_desktop.py
Self-test (no display):  python3 omerta_desktop.py --selftest
"""
from __future__ import annotations

import os
import sys

# Locate the shared engine (omerta_brain.py): installed beside this file, or in ../brain.
_HERE = os.path.dirname(os.path.abspath(__file__))
for _cand in (_HERE, os.path.join(_HERE, "brain"), os.path.abspath(os.path.join(_HERE, "..", "brain"))):
    if os.path.exists(os.path.join(_cand, "omerta_brain.py")):
        sys.path.insert(0, _cand)
        break
import omerta_brain as ob  # noqa: E402

APP_NAME = "Omerta AI"
VERSION = "1.1.0"

# OMERTA operator-console palette.
BLACK = "#0A0A0B"; SURFACE = "#141416"; SURFACE_HI = "#1E1E22"; BORDER = "#2A2A2E"
AMBER = "#FFB300"; GREEN = "#00E676"; RED = "#FF5252"
TEXT = "#ECECEC"; TEXT_DIM = "#9A9AA0"; USER_BG = "#1F2A1A"


def data_dir() -> str:
    base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    d = os.path.join(base, "omerta-ai", "brains")
    os.makedirs(d, exist_ok=True)
    return d


# ---------------------------------------------------------------- library (no GUI)

class BrainLibrary:
    """On-disk brain library + engine, independent of the GUI (so it is unit-testable)."""

    def __init__(self, directory: str | None = None):
        self.dir = directory or data_dir()
        os.makedirs(self.dir, exist_ok=True)
        self._active_file = os.path.join(self.dir, ".active")
        self.brain = self._load_active()
        self.engine = ob.Engine(self.brain)

    # -- persistence
    def path_for(self, brain_id: str) -> str:
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in brain_id)[:64] or "brain"
        return os.path.join(self.dir, f"{safe}.brain")

    def list(self) -> list[dict]:
        out = []
        for fn in sorted(os.listdir(self.dir)):
            if fn.endswith(".brain"):
                try:
                    out.append(ob.load(os.path.join(self.dir, fn)))
                except Exception:
                    pass
        return out

    def _seed(self) -> dict:
        # Prefer a bundled default brain, else a blank one.
        for cand in (os.path.join(_HERE, "omerta.brain"),
                     os.path.abspath(os.path.join(_HERE, "..", "brain", "brains", "omerta.brain"))):
            if os.path.exists(cand):
                try:
                    b = ob.load(cand)
                    self.save(b)
                    return b
                except Exception:
                    break
        b = ob.blank("Omerta")
        self.save(b)
        return b

    def _load_active(self) -> dict:
        active = None
        if os.path.exists(self._active_file):
            active = open(self._active_file).read().strip() or None
        if active:
            p = self.path_for(active)
            if os.path.exists(p):
                return ob.load(p)
        existing = self.list()
        if existing:
            self.set_active(existing[0]["id"])
            return existing[0]
        b = self._seed()
        self.set_active(b["id"])
        return b

    def set_active(self, brain_id: str):
        with open(self._active_file, "w") as f:
            f.write(brain_id)

    def save(self, brain: dict | None = None):
        b = brain or self.brain
        ob.save(b, self.path_for(b["id"]))

    def commit(self):
        self.save(self.brain)

    # -- ops
    def respond(self, text: str) -> str:
        out = self.engine.respond(text)
        self.commit()
        return out

    def switch_to(self, brain_id: str):
        self.commit()
        self.brain = ob.load(self.path_for(brain_id))
        self.engine = ob.Engine(self.brain)
        self.set_active(brain_id)

    def create(self, name: str, tone: str = "calm") -> dict:
        b = ob.blank(name.strip() or "New Brain", tone)
        if os.path.exists(self.path_for(b["id"])):
            b["id"] += "-" + format(ob.now_ms(), "x")
        self.save(b)
        self.switch_to(b["id"])
        return b

    def delete_active(self):
        p = self.path_for(self.brain["id"])
        if os.path.exists(p):
            os.remove(p)
        remaining = self.list()
        if remaining:
            self.switch_to(remaining[0]["id"])
        else:
            b = self._seed(); self.switch_to(b["id"])

    def teach_files(self, paths: list[str]) -> int:
        total = 0
        for p in paths:
            if p.lower().endswith(".brain") or p.lower().endswith(".json"):
                try:
                    b = ob.load(p)
                    self.save(b); self.switch_to(b["id"]); continue
                except Exception:
                    pass
            try:
                text = ob.read_text(p)
            except Exception:
                continue
            total += ob.add_document(self.brain, text, os.path.basename(p),
                                     os.path.splitext(os.path.basename(p))[0])
        self.engine._index()  # rebuild retrieval index over the new knowledge
        self.commit()
        return total

    def export(self, path: str):
        ob.save(self.brain, path)

    def stats_line(self) -> str:
        b = self.brain
        return (f'{b["persona"]["name"]} · {b["persona"]["tone"]} · '
                f'{len(b["knowledge"])} facts · {len(b["reflexes"])} replies · '
                f'{len(b["lessons"])} rules')


# ---------------------------------------------------------------- GUI

def launch_gui(lib: BrainLibrary):
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title(f"{APP_NAME} — offline brain")
    root.configure(bg=BLACK)
    root.geometry("880x680")
    root.minsize(560, 480)

    mono = ("JetBrains Mono", 11) if _has_font(root, "JetBrains Mono") else ("monospace", 11)
    mono_b = (mono[0], 13, "bold")

    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass
    style.configure("TCombobox", fieldbackground=SURFACE, background=SURFACE, foreground=TEXT)

    # --- header
    header = tk.Frame(root, bg=BLACK)
    header.pack(fill="x", padx=14, pady=(12, 4))
    title = tk.Label(header, text="◆ OMERTA AI", fg=AMBER, bg=BLACK, font=(mono[0], 15, "bold"))
    title.pack(side="left")
    status = tk.Label(header, text="offline", fg=GREEN, bg=BLACK, font=(mono[0], 10))
    status.pack(side="right")

    substatus = tk.Label(root, text=lib.stats_line(), fg=TEXT_DIM, bg=BLACK, font=(mono[0], 9), anchor="w")
    substatus.pack(fill="x", padx=16)

    # --- transcript
    trans_wrap = tk.Frame(root, bg=BLACK)
    trans_wrap.pack(fill="both", expand=True, padx=12, pady=6)
    transcript = tk.Text(trans_wrap, bg=SURFACE, fg=TEXT, font=mono, wrap="word",
                         relief="flat", padx=12, pady=12, insertbackground=AMBER,
                         highlightthickness=1, highlightbackground=BORDER, state="disabled")
    scroll = tk.Scrollbar(trans_wrap, command=transcript.yview)
    transcript.configure(yscrollcommand=scroll.set)
    scroll.pack(side="right", fill="y")
    transcript.pack(side="left", fill="both", expand=True)
    transcript.tag_configure("you", foreground=GREEN, font=mono_b)
    transcript.tag_configure("brain", foreground=AMBER, font=mono_b)
    transcript.tag_configure("body", foreground=TEXT)
    transcript.tag_configure("sys", foreground=TEXT_DIM, font=(mono[0], 9, "italic"))

    def add(role: str, text: str):
        transcript.configure(state="normal")
        if role == "you":
            transcript.insert("end", "you  ", "you"); transcript.insert("end", text + "\n\n", "body")
        elif role == "brain":
            transcript.insert("end", f'{lib.brain["persona"]["name"]}  ', "brain")
            transcript.insert("end", text + "\n\n", "body")
        else:
            transcript.insert("end", text + "\n", "sys")
        transcript.configure(state="disabled")
        transcript.see("end")

    def refresh_status():
        substatus.configure(text=lib.stats_line())
        root.title(f'{APP_NAME} — {lib.brain["name"]}')

    add("brain", lib.brain["persona"].get("greeting", "Online. What do you need?"))
    refresh_status()

    # --- input row
    row = tk.Frame(root, bg=BLACK)
    row.pack(fill="x", padx=12, pady=(0, 10))
    entry = tk.Text(row, bg=SURFACE, fg=TEXT, font=mono, height=2, wrap="word", relief="flat",
                    padx=10, pady=8, insertbackground=AMBER, highlightthickness=1,
                    highlightbackground=BORDER, highlightcolor=AMBER)
    entry.pack(side="left", fill="both", expand=True)

    def send(_evt=None):
        text = entry.get("1.0", "end").strip()
        if not text:
            return "break"
        entry.delete("1.0", "end")
        add("you", text)
        add("brain", lib.respond(text))
        refresh_status()
        return "break"

    entry.bind("<Return>", send)
    entry.bind("<Shift-Return>", lambda e: None)  # newline

    def btn(parent, label, cmd, fg=BLACK, bg=AMBER):
        b = tk.Button(parent, text=label, command=cmd, fg=fg, bg=bg, font=(mono[0], 10, "bold"),
                      relief="flat", activebackground=SURFACE_HI, activeforeground=AMBER,
                      padx=12, pady=6, bd=0, highlightthickness=0, cursor="hand2")
        return b

    btn(row, "SEND", send).pack(side="left", padx=(8, 0), fill="y")

    # --- toolbar
    bar = tk.Frame(root, bg=BLACK)
    bar.pack(fill="x", padx=12, pady=(0, 12))

    def do_upload():
        paths = filedialog.askopenfilenames(
            title="Teach from files",
            filetypes=[("Text/brain", "*.txt *.md *.csv *.html *.htm *.brain *.json"), ("All files", "*.*")])
        if not paths:
            return
        n = lib.teach_files(list(paths))
        add("sys", f"🧠 learned {n} knowledge chunk(s) from {len(paths)} file(s)")
        refresh_status()

    def do_import():
        p = filedialog.askopenfilename(title="Import a .brain", filetypes=[("Brain", "*.brain *.json"), ("All", "*.*")])
        if not p:
            return
        try:
            b = ob.load(p); lib.save(b); lib.switch_to(b["id"])
            add("sys", f'🧠 installed and switched to "{b["name"]}"'); reload_all()
        except Exception as e:
            messagebox.showerror("Import failed", str(e))

    def do_export():
        p = filedialog.asksaveasfilename(title="Export brain", defaultextension=".brain",
                                         initialfile=f'{lib.brain["id"]}.brain')
        if p:
            lib.export(p); add("sys", f"🧠 exported to {p}")

    def do_new():
        name = _ask(root, "New brain", "Name:", mono)
        if name:
            lib.create(name); add("sys", f"🧠 created {name}"); reload_all()

    def do_switch():
        brains = lib.list()
        if len(brains) <= 1:
            add("sys", "only one brain — create or import another first"); return
        win = tk.Toplevel(root, bg=BLACK); win.title("Switch brain")
        tk.Label(win, text="Choose a brain:", fg=AMBER, bg=BLACK, font=mono).pack(padx=16, pady=(14, 6))
        for b in brains:
            mark = "● " if b["id"] == lib.brain["id"] else "○ "
            tk.Button(win, text=f'{mark}{b["name"]}  ({b["persona"]["name"]}, {len(b["knowledge"])} facts)',
                      anchor="w", fg=TEXT, bg=SURFACE, relief="flat", font=mono, padx=10, pady=6,
                      command=lambda bid=b["id"]: (lib.switch_to(bid), win.destroy(), reload_all())
                      ).pack(fill="x", padx=16, pady=2)
        win.geometry("420x320")

    def do_personality():
        open_personality(root, lib, mono, on_saved=reload_all)

    def do_reset():
        if messagebox.askyesno("Delete brain", f'Delete "{lib.brain["name"]}" and everything it learned?'):
            lib.delete_active(); add("sys", "🧠 deleted"); reload_all()

    def reload_all():
        transcript.configure(state="normal"); transcript.delete("1.0", "end"); transcript.configure(state="disabled")
        add("brain", lib.brain["persona"].get("greeting", "Ready."))
        refresh_status()

    for label, cmd in [("＋ Upload files", do_upload), ("Personality", do_personality),
                       ("New", do_new), ("Switch", do_switch), ("Import", do_import),
                       ("Export", do_export), ("Delete", do_reset)]:
        btn(bar, label, cmd, fg=AMBER, bg=SURFACE).pack(side="left", padx=(0, 6))

    hint = tk.Label(root, text='teach me: "remember that…" · "when I say X, say Y" · "wrong, it\'s…" · '
                                '"forget…" · "what do you know" · Enter sends, Shift+Enter = newline',
                    fg=TEXT_DIM, bg=BLACK, font=(mono[0], 8))
    hint.pack(fill="x", padx=16, pady=(0, 10))

    entry.focus_set()
    root.mainloop()


def open_personality(root, lib: BrainLibrary, mono, on_saved):
    import tkinter as tk
    from tkinter import messagebox
    p = lib.brain["persona"]
    win = tk.Toplevel(root, bg=BLACK); win.title("Personality")
    win.geometry("560x620")
    fields = {}

    def field(label, key, value, multiline=False):
        tk.Label(win, text=label, fg=AMBER, bg=BLACK, font=(mono[0], 9)).pack(anchor="w", padx=16, pady=(8, 0))
        if multiline:
            w = tk.Text(win, height=3, bg=SURFACE, fg=TEXT, font=mono, relief="flat", padx=8, pady=6,
                        insertbackground=AMBER, highlightthickness=1, highlightbackground=BORDER)
            w.insert("1.0", value)
        else:
            w = tk.Entry(win, bg=SURFACE, fg=TEXT, font=mono, relief="flat", insertbackground=AMBER,
                         highlightthickness=1, highlightbackground=BORDER)
            w.insert(0, value)
        w.pack(fill="x", padx=16, pady=2, ipady=3)
        fields[key] = (w, multiline)

    field("Name", "name", p.get("name", ""))
    field("Tagline", "tagline", p.get("tagline", ""))
    field("Greeting", "greeting", p.get("greeting", ""), True)
    field("Character description", "description", p.get("description", ""), True)
    field("Traits (comma separated)", "traits", ", ".join(p.get("traits", [])))
    field("Catchphrases (one per line)", "catchphrases", "\n".join(p.get("catchphrases", [])), True)
    field("When it doesn't know (one per line)", "fallbacks", "\n".join(p.get("fallbacks", [])), True)

    tk.Label(win, text="Tone", fg=AMBER, bg=BLACK, font=(mono[0], 9)).pack(anchor="w", padx=16, pady=(8, 0))
    tone_var = tk.StringVar(value=p.get("tone", "calm"))
    trow = tk.Frame(win, bg=BLACK); trow.pack(fill="x", padx=12)
    for t in ob.TONES:
        tk.Radiobutton(trow, text=t, variable=tone_var, value=t, fg=TEXT, bg=BLACK, selectcolor=SURFACE,
                       font=(mono[0], 8), activebackground=BLACK, activeforeground=AMBER).pack(side="left")

    verb_var = tk.StringVar(value=p.get("verbosity", "medium"))
    tk.Label(win, text="Answer length", fg=AMBER, bg=BLACK, font=(mono[0], 9)).pack(anchor="w", padx=16, pady=(8, 0))
    vrow = tk.Frame(win, bg=BLACK); vrow.pack(fill="x", padx=12)
    for v in ("short", "medium", "long"):
        tk.Radiobutton(vrow, text=v, variable=verb_var, value=v, fg=TEXT, bg=BLACK, selectcolor=SURFACE,
                       font=(mono[0], 8), activebackground=BLACK, activeforeground=AMBER).pack(side="left")

    emoji_var = tk.BooleanVar(value=p.get("emoji", False))
    tk.Checkbutton(win, text="use emoji", variable=emoji_var, fg=TEXT, bg=BLACK, selectcolor=SURFACE,
                   activebackground=BLACK, activeforeground=AMBER, font=(mono[0], 9)).pack(anchor="w", padx=16, pady=6)

    def save():
        def lines(x):
            return [s.strip() for s in x.split("\n") if s.strip()]
        for key, (w, multiline) in fields.items():
            val = w.get("1.0", "end").strip() if multiline else w.get().strip()
            if key == "traits":
                p[key] = [s.strip() for s in val.split(",") if s.strip()]
            elif key in ("catchphrases", "fallbacks"):
                p[key] = lines(val)
            else:
                p[key] = val
        p["tone"] = tone_var.get(); p["verbosity"] = verb_var.get(); p["emoji"] = emoji_var.get()
        if not p["name"]:
            p["name"] = "Omerta"
        lib.brain["name"] = p["name"]
        lib.engine.b = lib.brain
        lib.commit()
        messagebox.showinfo("Saved", "Personality saved.")
        win.destroy(); on_saved()

    tk.Button(win, text="SAVE PERSONALITY", command=save, fg=BLACK, bg=AMBER, font=(mono[0], 10, "bold"),
              relief="flat", padx=12, pady=8, cursor="hand2").pack(fill="x", padx=16, pady=14)


def _ask(root, title, prompt, mono):
    import tkinter as tk
    win = tk.Toplevel(root, bg=BLACK); win.title(title); win.geometry("360x140")
    tk.Label(win, text=prompt, fg=AMBER, bg=BLACK, font=mono).pack(padx=16, pady=(18, 6), anchor="w")
    var = tk.StringVar()
    e = tk.Entry(win, textvariable=var, bg=SURFACE, fg=TEXT, font=mono, relief="flat",
                 insertbackground=AMBER, highlightthickness=1, highlightbackground=BORDER)
    e.pack(fill="x", padx=16, ipady=4); e.focus_set()
    out = {}
    def ok():
        out["v"] = var.get().strip(); win.destroy()
    e.bind("<Return>", lambda _e: ok())
    tk.Button(win, text="OK", command=ok, fg=BLACK, bg=AMBER, font=(mono[0], 10, "bold"),
              relief="flat", padx=12, pady=6).pack(pady=12)
    win.wait_window()
    return out.get("v")


def _has_font(root, name: str) -> bool:
    try:
        import tkinter.font as tkfont
        return name in tkfont.families(root)
    except Exception:
        return False


# ---------------------------------------------------------------- entry / self-test

def selftest() -> int:
    import tempfile
    d = tempfile.mkdtemp()
    lib = BrainLibrary(d)
    assert lib.brain["format"] == "omerta-brain/1"
    assert lib.respond("remember that the vault code is 9981")
    assert "9981" in lib.respond("what is the vault code")
    lib.respond("when I say ping, say pong")
    assert lib.respond("ping") == "pong"
    # file teaching
    doc = os.path.join(d, "n.md"); open(doc, "w").write("The spare key is under the flowerpot.")
    assert lib.teach_files([doc]) >= 1
    assert "flowerpot" in lib.respond("where is the spare key")
    # library ops
    lib.create("Luna", "playful")
    assert lib.brain["name"] == "Luna"
    assert len(lib.list()) >= 2
    out = os.path.join(d, "luna.brain"); lib.export(out)
    assert ob.load(out)["name"] == "Luna"
    print("desktop self-test: OK")
    return 0


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if "--version" in argv:
        print(f"{APP_NAME} {VERSION}"); return 0
    if "--selftest" in argv:
        return selftest()
    lib = BrainLibrary()
    try:
        import tkinter  # noqa: F401
    except Exception:
        sys.stderr.write(
            "Omerta AI desktop needs Tk. On Linux Mint / Ubuntu:\n"
            "  sudo apt install python3-tk\n"
            "(the .deb declares this dependency; the AppImage/PyInstaller build bundles it.)\n")
        return 2
    launch_gui(lib)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
