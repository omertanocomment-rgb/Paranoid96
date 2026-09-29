package ai.omerta.assistant.data.agent

/** How dangerous a tool action is, so the app can decide when to ask and what to explain. */
enum class RiskLevel { LOW, MEDIUM, HIGH }

/**
 * Classifies a proposed device/agent action and produces a plain-language reason.
 * The app uses this to gate autonomy: LOW actions may run unattended, MEDIUM/HIGH
 * always ask, and HIGH shows *why* before the operator approves.
 *
 * Owned-device / authorized-operator use only — the whole point of the reason string
 * is to keep the human in control of anything consequential.
 */
object Risk {

    data class Assessment(val level: RiskLevel, val reason: String)

    /** Shell fragments that change or destroy state, touch other apps, or reach the network. */
    private val destructive = listOf(
        "rm ", "rm -", "mkfs", "dd ", "> /", ":>", "shred", "wipe", "format",
        "fastboot", "flash", "reboot", "shutdown", "pm uninstall", "pm clear",
        "settings put", "svc ", "killall", "pkill", "kill -", "chmod 777", "chown ",
        "mount ", "umount", "iptables", "ip route", "setprop", "resetprop",
    )
    private val networkish = listOf("curl", "wget", "nc ", "ssh", "scp", "ping", "http://", "https://", "ftp")
    private val privileged = listOf("su ", "su-", "sudo", "/system/", "/data/data/", "magisk", "root")

    fun forTool(name: String, input: Map<String, String>): Assessment = when (name) {
        "list_dir", "read_file", "device_info", "list_packages" ->
            Assessment(RiskLevel.LOW, "Read-only: it only looks, nothing changes.")

        "fetch_url", "http_request" -> {
            val method = input["method"]?.uppercase() ?: "GET"
            val url = input["url"].orEmpty()
            if (method == "GET") Assessment(RiskLevel.LOW, "Downloads $url. Nothing on the device changes.")
            else Assessment(RiskLevel.MEDIUM, "Sends a $method request to $url — this can change data on that server.")
        }

        "write_file" -> {
            val p = input["path"].orEmpty()
            if (looksSystem(p)) Assessment(RiskLevel.HIGH,
                "Writes into a system/app location ($p). A bad write here can break apps or the OS.")
            else Assessment(RiskLevel.MEDIUM, "Creates or overwrites $p. Any existing file there is replaced.")
        }

        "delete_file" -> {
            val p = input["path"].orEmpty()
            Assessment(if (looksSystem(p)) RiskLevel.HIGH else RiskLevel.MEDIUM,
                "Deletes $p. This can't be undone from the app." +
                    if (looksSystem(p)) " It's a system/app path, so this can break things." else "")
        }

        "move_file" -> Assessment(RiskLevel.MEDIUM,
            "Moves ${input["from"]} → ${input["to"]}, replacing anything already at the destination.")

        "run_shell" -> {
            val cmd = input["command"].orEmpty().lowercase()
            val root = input["root"].equals("true", true)
            when {
                root || privileged.any { it in cmd } -> Assessment(RiskLevel.HIGH,
                    "Runs a command with root/system reach:\n  ${input["command"]}\nRoot commands can change or brick the whole device — there are no guardrails below this.")
                destructive.any { it in cmd } -> Assessment(RiskLevel.HIGH,
                    "This command deletes or reconfigures the device:\n  ${input["command"]}\nEffects are immediate and usually irreversible.")
                networkish.any { it in cmd } -> Assessment(RiskLevel.MEDIUM,
                    "This command reaches the network:\n  ${input["command"]}")
                else -> Assessment(RiskLevel.MEDIUM,
                    "Runs a shell command:\n  ${input["command"]}\nShell commands can have side effects.")
            }
        }

        else -> Assessment(RiskLevel.MEDIUM, "Runs \"$name\". Review the inputs before allowing it.")
    }

    private fun looksSystem(path: String): Boolean {
        val p = path.trim()
        return p.startsWith("/system") || p.startsWith("/data/data") || p.startsWith("/vendor") ||
            p.startsWith("/proc") || p.startsWith("/dev") || p.startsWith("/etc") || p.startsWith("/product")
    }
}
