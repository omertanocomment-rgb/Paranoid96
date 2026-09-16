"""
Example skill: wireless ADB helpers, matching OMERTA's tab-node-kit
pattern. Shows the plugin contract: a TOOLS dict of name -> fn(args)->result.
"""
from core import sandbox


def pair(args: dict):
    ip = args["ip"]
    port = args.get("port", "5555")
    code = args["pairing_code"]
    return sandbox.execute(f"adb pair {ip}:{port} {code}", confirmed=args.get("confirmed", False))


def connect(args: dict):
    ip = args["ip"]
    port = args.get("port", "5555")
    return sandbox.execute(f"adb connect {ip}:{port}", confirmed=args.get("confirmed", False))


def status(args: dict):
    return sandbox.execute("adb devices -l", confirmed=args.get("confirmed", False))


TOOLS = {
    "pair": pair,
    "connect": connect,
    "status": status,
}
