package ai.omerta.assistant.data.local

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import ai.omerta.assistant.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "omerta_settings")

/** How the app reaches the AI. */
object EngineMode {
    const val EMBEDDED = "embedded" // in-process: app calls the provider API directly
    const val REMOTE = "remote"     // via the external Omerta AI engine / Node backend
}

/** Which AI powers EMBEDDED mode. */
object Provider {
    const val ANTHROPIC = "anthropic"
    const val OPENAI = "openai"
    const val OLLAMA = "ollama"      // your own local models, no external limits
    const val BRAIN = "brain"        // fully offline on-device brain (+ optional on-device LLM)
    val ALL = listOf(ANTHROPIC, OPENAI, OLLAMA, BRAIN)
}

/**
 * How much the agent may act on its own. There is deliberately no "run everything
 * unattended" mode: anything medium/high-risk always stops for approval, and high-risk
 * actions explain *why* first. The operator stays in control of anything consequential.
 */
object Autonomy {
    const val ASK_ALL = "ask_all"    // ask before every tool (safest)
    const val AUTO_LOW = "auto_low"  // run read-only / low-risk tools automatically; ask for everything else
    val ALL = listOf(ASK_ALL, AUTO_LOW)
}

/** How the offline brain uses an on-device LLM (when a model file is loaded). */
object BrainLlmMode {
    const val OFF = "off"        // pure brain engine only (instant, deterministic)
    const val ASSIST = "assist"  // brain answers what it knows; the LLM handles the rest
    const val ALWAYS = "always"  // LLM speaks every reply, grounded in the brain's knowledge
    val ALL = listOf(OFF, ASSIST, ALWAYS)
}

/** Persisted user/operator settings. */
data class OmertaSettings(
    val engineMode: String,
    val anthropicApiKey: String,
    val backendUrl: String,
    val appToken: String,
    val model: String,
    val systemPrompt: String,
    val effort: String,
    val streaming: Boolean,
    val maxTokens: Int,
    val webSearch: Boolean,
    val codeExecution: Boolean,
    val mcpName: String,
    val mcpUrl: String,
    val agentMode: Boolean,
    val autoApprove: Boolean,
    val provider: String,
    val openAiKey: String,
    val ollamaUrl: String,
    // --- offline brain ---
    val brainLlmMode: String = BrainLlmMode.ASSIST,
    val brainModel: String = "",
    val brainPromptFormat: String = "auto",
    val brainGpu: Boolean = false,
    val brainTemperature: Float = 0.7f,
    /** Apply the active brain's personality + knowledge to online providers too. */
    val personaEverywhere: Boolean = false,
    /** If an online provider fails (no signal), answer from the offline brain instead. */
    val offlineFallback: Boolean = true,
    // --- agent autonomy (never fully unattended; medium/high always ask) ---
    val autonomy: String = Autonomy.AUTO_LOW,
    /** Let the agent propose a better approach before doing exactly what was asked. */
    val suggestBetter: Boolean = true,
    /** Adapt the active brain's personality to how the operator talks over time. */
    val adaptivePersona: Boolean = true,
    val onboarded: Boolean = false,
    // --- auto-backup ---
    val autoBackupDir: String = "",   // SAF tree uri (persisted); blank = off
    val autoBackupHours: Int = 0,     // 0 = off, else min hours between backups
    val lastBackupMs: Long = 0L,
    /** Opt-in: let the offline brain look up unknown questions on the web (DuckDuckGo/Wikipedia). */
    val brainWebSearch: Boolean = false,
) {
    val embedded: Boolean get() = engineMode == EngineMode.EMBEDDED
}

class SettingsStore(private val context: Context) {

    private object Keys {
        val ENGINE_MODE = stringPreferencesKey("engine_mode")
        val ANTHROPIC_KEY = stringPreferencesKey("anthropic_api_key")
        val BACKEND_URL = stringPreferencesKey("backend_url")
        val APP_TOKEN = stringPreferencesKey("app_token")
        val MODEL = stringPreferencesKey("model")
        val SYSTEM_PROMPT = stringPreferencesKey("system_prompt")
        val EFFORT = stringPreferencesKey("effort")
        val STREAMING = booleanPreferencesKey("streaming")
        val MAX_TOKENS = androidx.datastore.preferences.core.intPreferencesKey("max_tokens")
        val WEB_SEARCH = booleanPreferencesKey("web_search")
        val CODE_EXEC = booleanPreferencesKey("code_exec")
        val MCP_NAME = stringPreferencesKey("mcp_name")
        val MCP_URL = stringPreferencesKey("mcp_url")
        val AGENT_MODE = booleanPreferencesKey("agent_mode")
        val AUTO_APPROVE = booleanPreferencesKey("auto_approve")
        val PROVIDER = stringPreferencesKey("provider")
        val OPENAI_KEY = stringPreferencesKey("openai_key")
        val OLLAMA_URL = stringPreferencesKey("ollama_url")
        val BRAIN_LLM = stringPreferencesKey("brain_llm_mode")
        val BRAIN_MODEL = stringPreferencesKey("brain_model")
        val BRAIN_FORMAT = stringPreferencesKey("brain_prompt_format")
        val BRAIN_GPU = booleanPreferencesKey("brain_gpu")
        val BRAIN_TEMP = androidx.datastore.preferences.core.floatPreferencesKey("brain_temperature")
        val PERSONA_EVERYWHERE = booleanPreferencesKey("persona_everywhere")
        val OFFLINE_FALLBACK = booleanPreferencesKey("offline_fallback")
        val AUTONOMY = stringPreferencesKey("autonomy")
        val SUGGEST_BETTER = booleanPreferencesKey("suggest_better")
        val ADAPTIVE_PERSONA = booleanPreferencesKey("adaptive_persona")
        val ONBOARDED = booleanPreferencesKey("onboarded")
        val AUTO_BACKUP_DIR = stringPreferencesKey("auto_backup_dir")
        val AUTO_BACKUP_HOURS = androidx.datastore.preferences.core.intPreferencesKey("auto_backup_hours")
        val LAST_BACKUP_MS = androidx.datastore.preferences.core.longPreferencesKey("last_backup_ms")
        val BRAIN_WEB_SEARCH = booleanPreferencesKey("brain_web_search")
    }

    companion object {
        const val DEFAULT_MODEL = "claude-opus-5"
        const val DEFAULT_EFFORT = "high"
        val DEFAULT_SYSTEM = """
            You are Omerta AI, an operator-grade assistant for the OMERTA toolkit.
            Be precise, technical, and concise. Prefer copy-paste-ready commands and
            complete answers over fragments. Assume the user is an authorized operator
            working on owned devices and legitimate security-research tasks.
        """.trimIndent()
    }

    val settings: Flow<OmertaSettings> = context.dataStore.data.map { p ->
        val defaultMode = if (BuildConfig.EMBEDDED_MODE) EngineMode.EMBEDDED else EngineMode.REMOTE
        OmertaSettings(
            engineMode = p[Keys.ENGINE_MODE] ?: defaultMode,
            anthropicApiKey = p[Keys.ANTHROPIC_KEY]?.let(KeyVault::decrypt)?.takeIf { it.isNotBlank() }
                ?: BuildConfig.ANTHROPIC_API_KEY,
            backendUrl = p[Keys.BACKEND_URL]?.takeIf { it.isNotBlank() } ?: BuildConfig.OMERTA_BACKEND_URL,
            appToken = p[Keys.APP_TOKEN]?.let(KeyVault::decrypt) ?: "",
            model = p[Keys.MODEL] ?: DEFAULT_MODEL,
            systemPrompt = p[Keys.SYSTEM_PROMPT] ?: DEFAULT_SYSTEM,
            effort = p[Keys.EFFORT] ?: DEFAULT_EFFORT,
            streaming = p[Keys.STREAMING] ?: true,
            maxTokens = p[Keys.MAX_TOKENS] ?: 8192,
            webSearch = p[Keys.WEB_SEARCH] ?: false,
            codeExecution = p[Keys.CODE_EXEC] ?: false,
            mcpName = p[Keys.MCP_NAME] ?: "",
            mcpUrl = p[Keys.MCP_URL] ?: "",
            agentMode = p[Keys.AGENT_MODE] ?: false,
            autoApprove = p[Keys.AUTO_APPROVE] ?: false,
            provider = p[Keys.PROVIDER] ?: Provider.ANTHROPIC,
            openAiKey = p[Keys.OPENAI_KEY]?.let(KeyVault::decrypt) ?: "",
            ollamaUrl = p[Keys.OLLAMA_URL]?.takeIf { it.isNotBlank() } ?: "http://localhost:11434",
            brainLlmMode = p[Keys.BRAIN_LLM] ?: BrainLlmMode.ASSIST,
            brainModel = p[Keys.BRAIN_MODEL] ?: "",
            brainPromptFormat = p[Keys.BRAIN_FORMAT] ?: "auto",
            brainGpu = p[Keys.BRAIN_GPU] ?: false,
            brainTemperature = p[Keys.BRAIN_TEMP] ?: 0.7f,
            personaEverywhere = p[Keys.PERSONA_EVERYWHERE] ?: false,
            offlineFallback = p[Keys.OFFLINE_FALLBACK] ?: true,
            autonomy = p[Keys.AUTONOMY] ?: Autonomy.AUTO_LOW,
            suggestBetter = p[Keys.SUGGEST_BETTER] ?: true,
            adaptivePersona = p[Keys.ADAPTIVE_PERSONA] ?: true,
            onboarded = p[Keys.ONBOARDED] ?: false,
            autoBackupDir = p[Keys.AUTO_BACKUP_DIR] ?: "",
            autoBackupHours = p[Keys.AUTO_BACKUP_HOURS] ?: 0,
            lastBackupMs = p[Keys.LAST_BACKUP_MS] ?: 0L,
            brainWebSearch = p[Keys.BRAIN_WEB_SEARCH] ?: false,
        )
    }

    suspend fun update(
        engineMode: String? = null,
        anthropicApiKey: String? = null,
        backendUrl: String? = null,
        appToken: String? = null,
        model: String? = null,
        systemPrompt: String? = null,
        effort: String? = null,
        streaming: Boolean? = null,
        maxTokens: Int? = null,
        webSearch: Boolean? = null,
        codeExecution: Boolean? = null,
        mcpName: String? = null,
        mcpUrl: String? = null,
        agentMode: Boolean? = null,
        autoApprove: Boolean? = null,
        provider: String? = null,
        openAiKey: String? = null,
        ollamaUrl: String? = null,
    ) {
        context.dataStore.edit { p ->
            engineMode?.let { p[Keys.ENGINE_MODE] = it }
            anthropicApiKey?.let { p[Keys.ANTHROPIC_KEY] = KeyVault.encrypt(it.trim()) }
            backendUrl?.let { p[Keys.BACKEND_URL] = it.trim() }
            appToken?.let { p[Keys.APP_TOKEN] = KeyVault.encrypt(it.trim()) }
            model?.let { p[Keys.MODEL] = it }
            systemPrompt?.let { p[Keys.SYSTEM_PROMPT] = it }
            effort?.let { p[Keys.EFFORT] = it }
            streaming?.let { p[Keys.STREAMING] = it }
            maxTokens?.let { p[Keys.MAX_TOKENS] = it }
            webSearch?.let { p[Keys.WEB_SEARCH] = it }
            codeExecution?.let { p[Keys.CODE_EXEC] = it }
            mcpName?.let { p[Keys.MCP_NAME] = it.trim() }
            mcpUrl?.let { p[Keys.MCP_URL] = it.trim() }
            agentMode?.let { p[Keys.AGENT_MODE] = it }
            autoApprove?.let { p[Keys.AUTO_APPROVE] = it }
            provider?.let { p[Keys.PROVIDER] = it }
            openAiKey?.let { p[Keys.OPENAI_KEY] = KeyVault.encrypt(it.trim()) }
            ollamaUrl?.let { p[Keys.OLLAMA_URL] = it.trim() }
        }
    }

    suspend fun setOnboarded() { context.dataStore.edit { it[Keys.ONBOARDED] = true } }

    suspend fun setAutoBackup(dir: String?, hours: Int?) {
        context.dataStore.edit { p ->
            dir?.let { p[Keys.AUTO_BACKUP_DIR] = it }
            hours?.let { p[Keys.AUTO_BACKUP_HOURS] = it }
        }
    }

    suspend fun markBackupNow() { context.dataStore.edit { it[Keys.LAST_BACKUP_MS] = System.currentTimeMillis() } }

    suspend fun updateBrain(
        llmMode: String? = null,
        model: String? = null,
        promptFormat: String? = null,
        gpu: Boolean? = null,
        temperature: Float? = null,
        personaEverywhere: Boolean? = null,
        offlineFallback: Boolean? = null,
        autonomy: String? = null,
        suggestBetter: Boolean? = null,
        adaptivePersona: Boolean? = null,
        webSearch: Boolean? = null,
    ) {
        context.dataStore.edit { p ->
            autonomy?.let { p[Keys.AUTONOMY] = it }
            suggestBetter?.let { p[Keys.SUGGEST_BETTER] = it }
            adaptivePersona?.let { p[Keys.ADAPTIVE_PERSONA] = it }
            webSearch?.let { p[Keys.BRAIN_WEB_SEARCH] = it }
            llmMode?.let { p[Keys.BRAIN_LLM] = it }
            model?.let { p[Keys.BRAIN_MODEL] = it }
            promptFormat?.let { p[Keys.BRAIN_FORMAT] = it }
            gpu?.let { p[Keys.BRAIN_GPU] = it }
            temperature?.let { p[Keys.BRAIN_TEMP] = it }
            personaEverywhere?.let { p[Keys.PERSONA_EVERYWHERE] = it }
            offlineFallback?.let { p[Keys.OFFLINE_FALLBACK] = it }
        }
    }
}
