package ai.omerta.assistant

import ai.omerta.assistant.data.agent.Risk
import ai.omerta.assistant.data.agent.RiskLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The autonomy gate is only as good as the risk classifier — pin its decisions. */
class RiskTest {

    private fun level(name: String, input: Map<String, String>) = Risk.forTool(name, input).level

    @Test fun readOnlyToolsAreLow() {
        assertEquals(RiskLevel.LOW, level("list_dir", mapOf("path" to "/sdcard")))
        assertEquals(RiskLevel.LOW, level("read_file", mapOf("path" to "notes.txt")))
        assertEquals(RiskLevel.LOW, level("device_info", emptyMap()))
        assertEquals(RiskLevel.LOW, level("fetch_url", mapOf("url" to "https://example.com")))
    }

    @Test fun writesAndDeletesAreAtLeastMedium() {
        assertEquals(RiskLevel.MEDIUM, level("write_file", mapOf("path" to "/sdcard/a.txt")))
        assertEquals(RiskLevel.MEDIUM, level("delete_file", mapOf("path" to "/sdcard/a.txt")))
        assertEquals(RiskLevel.MEDIUM, level("http_request", mapOf("url" to "https://x", "method" to "POST")))
    }

    @Test fun systemPathsAndRootAreHigh() {
        assertEquals(RiskLevel.HIGH, level("write_file", mapOf("path" to "/system/build.prop")))
        assertEquals(RiskLevel.HIGH, level("delete_file", mapOf("path" to "/data/data/com.foo")))
        assertEquals(RiskLevel.HIGH, level("run_shell", mapOf("command" to "echo hi", "root" to "true")))
        assertEquals(RiskLevel.HIGH, level("run_shell", mapOf("command" to "rm -rf /sdcard/x")))
        assertEquals(RiskLevel.HIGH, level("run_shell", mapOf("command" to "su -c reboot")))
    }

    @Test fun plainShellIsMediumAndExplained() {
        val a = Risk.forTool("run_shell", mapOf("command" to "ls -la"))
        assertEquals(RiskLevel.MEDIUM, a.level)
        assertTrue(a.reason.isNotBlank())
    }

    @Test fun everyHighRiskHasAReason() {
        val a = Risk.forTool("run_shell", mapOf("command" to "dd if=/dev/zero of=/dev/block/x"))
        assertEquals(RiskLevel.HIGH, a.level)
        assertTrue(a.reason, a.reason.length > 20)
    }
}
