package com.omerta.agent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.omerta.agent.OmertaClient
import com.omerta.agent.err
import com.omerta.agent.list
import com.omerta.agent.names
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * The repository, as it actually stands.
 *
 * Everything on this screen is READ-ONLY, and that is the design rather than
 * a gap. `core/gitx` enforces a whitelist of git subcommands that cannot
 * change a repository. Anything that rewrites history — commit, push, reset,
 * checkout, clean — stays a shell command through the approval gate, where
 * `git push --force` and `reset --hard` are already classified High-Risk.
 *
 * So the buttons that change things do not run git here. They write the
 * request into the chat box and let the agent propose it, which puts the
 * exact command on an approval card before anything happens. Two ways to move
 * a branch, one of them ungated, is how a safety property quietly stops being
 * one.
 */
@Composable
fun GitScreen(vm: ChatViewModel, onAskInChat: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var st by remember { mutableStateOf<JSONObject?>(null) }
    var log by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var branches by remember { mutableStateOf<List<String>>(emptyList()) }
    var diff by remember { mutableStateOf("") }
    var staged by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }

    suspend fun refresh() {
        val s = OmertaClient.gitStatus()
        note = s.err()
        st = if (note.isEmpty()) s else null
        if (note.isNotEmpty()) return
        log = OmertaClient.gitLog(20).list("commits")
        branches = OmertaClient.gitBranches().names("branches")
        diff = OmertaClient.gitDiff(staged).optString("diff", "")
    }

    LaunchedEffect(staged) { refresh() }

    LazyColumn(
        Modifier.fillMaxSize().background(Ink),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Section("Repository", trailing = st?.optString("branch", "") ?: "") {
                if (st == null) {
                    Empty(note.ifEmpty { "not a git repository" })
                } else {
                    ListRow("branch", right = st!!.optString("branch", "?"),
                            rightColor = Ember, mono = true)
                    Spacer(Modifier.height(6.dp))
                    ListRow("staged", right = "${st!!.optInt("staged", 0)}",
                            rightColor = Good)
                    Spacer(Modifier.height(6.dp))
                    ListRow("unstaged", right = "${st!!.optInt("unstaged", 0)}",
                            rightColor = Amber)
                    Spacer(Modifier.height(6.dp))
                    ListRow("untracked", right = "${st!!.optInt("untracked", 0)}")
                    Spacer(Modifier.height(8.dp))
                    Chip("REFRESH", false, Modifier.fillMaxWidth()) {
                        scope.launch { refresh() }
                    }
                }
            }
        }

        if (st != null) {
            item {
                Section("Changes", trailing = if (staged) "staged" else "working") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip("WORKING", !staged, Modifier.weight(1f)) { staged = false }
                        Chip("STAGED", staged, Modifier.weight(1f)) { staged = true }
                    }
                    Spacer(Modifier.height(8.dp))
                    st!!.list("changes").take(60).forEach { c ->
                        ListRow(c.optString("path"),
                                right = c.optString("xy").trim().ifEmpty { "?" },
                                rightColor = when (c.optString("xy").trim()) {
                                    "??" -> TextLo
                                    "M" -> Amber
                                    "D" -> Ember
                                    else -> Good
                                },
                                mono = true)
                        Spacer(Modifier.height(6.dp))
                    }
                    if (diff.isNotEmpty()) {
                        Spacer(Modifier.height(4.dp))
                        Mono(diff, max = 300)
                    }
                }
            }

            // These do not run git. They put the request to the agent, which
            // proposes the exact command on an approval card first.
            item {
                Section("Act on it") {
                    Text("These go through the agent, so the exact command "
                         + "lands on an approval card before anything runs. "
                         + "Nothing on this screen can change the repository "
                         + "by itself.",
                         style = MaterialTheme.typography.bodySmall, color = TextLo)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip("STAGE ALL", false, Modifier.weight(1f)) {
                            onAskInChat("Stage every change in this repository.")
                        }
                        Chip("COMMIT", false, Modifier.weight(1f), tint = Amber) {
                            onAskInChat("Read the staged diff and commit it " +
                                        "with a message that says what changed " +
                                        "and why. Show me the message first.")
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip("PUSH", false, Modifier.weight(1f), tint = Blood) {
                            onAskInChat("Push the current branch to its remote.")
                        }
                        Chip("REVIEW MY DIFF", false, Modifier.weight(1f)) {
                            scope.launch {
                                val r = OmertaClient.gitReview()
                                onAskInChat(
                                    "Review these working changes and tell me " +
                                    "what is wrong with them:\n\n```\n" +
                                    r.optString("diff", "").take(6000) + "\n```")
                            }
                        }
                    }
                }
            }

            item {
                Section("Recent commits", trailing = "${log.size}") {
                    if (log.isEmpty()) Empty("no commits")
                    log.forEach { c ->
                        ListRow(c.optString("subject"),
                                detail = "${c.optString("hash")} · " +
                                         "${c.optString("author")} · " +
                                         c.optString("date"),
                                mono = true) {
                            onAskInChat("Explain what commit " +
                                        c.optString("hash") + " changed.")
                        }
                        Spacer(Modifier.height(6.dp))
                    }
                }
            }

            item {
                Section("Branches", trailing = "${branches.size}") {
                    branches.take(40).forEach { b ->
                        ListRow(b, selected = b == st?.optString("branch"),
                                mono = true)
                        Spacer(Modifier.height(6.dp))
                    }
                }
            }
        }
    }
}
