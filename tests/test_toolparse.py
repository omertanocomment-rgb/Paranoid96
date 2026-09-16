"""Tolerant tool-call parsing — the failure modes small local models produce."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import toolparse as tp  # noqa: E402

CASES = [
    ("clean",            '```tool\n{"tool":"run_shell","args":{"cmd":"ls"}}\n```', "ls"),
    ("json fence",       '```json\n{"tool":"run_shell","args":{"cmd":"ls"}}\n```', "ls"),
    ("no fence",         '{"tool":"run_shell","args":{"cmd":"ls"}}', "ls"),
    ("prose then block", 'I will list files.\n```tool\n{"tool":"run_shell","args":{"cmd":"ls"}}\n```', "ls"),
    ("single quotes",    "```tool\n{'tool':'run_shell','args':{'cmd':'ls'}}\n```", "ls"),
    ("trailing comma",   '```tool\n{"tool":"run_shell","args":{"cmd":"ls"},}\n```', "ls"),
    ("python bools",     '```tool\n{"tool":"run_shell","args":{"cmd":"ls","confirmed":False}}\n```', "ls"),
    ("unfenced label",   'tool: {"tool":"run_shell","args":{"cmd":"ls"}}', "ls"),
    ("tool_call fence",  '```tool_call\n{"tool":"run_shell","args":{"cmd":"ls"}}\n```', "ls"),
    ("backticks in arg", '```tool\n{"tool":"run_shell","args":{"cmd":"echo `date`"}}\n```', "echo `date`"),
    ("comment line",     '```tool\n// listing\n{"tool":"run_shell","args":{"cmd":"ls"}}\n```', "ls"),
    ("name/arguments",   '```tool\n{"name":"run_shell","arguments":{"cmd":"ls"}}\n```', "ls"),
    ("openai nested",    '{"function":{"name":"run_shell","arguments":"{\\"cmd\\":\\"ls\\"}"}}', "ls"),
    ("xml tags",         '<tool>{"tool":"run_shell","args":{"cmd":"ls"}}</tool>', "ls"),
    ("flat args",        '```tool\n{"tool":"run_shell","cmd":"ls"}\n```', "ls"),
]

def main():
    ok = True
    for label, text, expect in CASES:
        r = tp.parse(text)
        good = bool(r and r["tool"] == "run_shell" and r["args"].get("cmd") == expect)
        print(f"  {'✓' if good else '✗'} {label}")
        ok = ok and good
    none_case = tp.parse("The build succeeded. Nothing else to do.")
    print(f"  {'✓' if none_case is None else '✗'} plain prose -> no tool call")
    ok = ok and none_case is None
    stripped = tp.strip_call('Listing now.\n```tool\n{"tool":"list_dir","args":{}}\n```')
    print(f"  {'✓' if stripped == 'Listing now.' else '✗'} strip_call leaves prose")
    ok = ok and stripped == "Listing now."
    print("\n" + ("TOOLPARSE TESTS PASSED" if ok else "TOOLPARSE TESTS FAILED"))
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
