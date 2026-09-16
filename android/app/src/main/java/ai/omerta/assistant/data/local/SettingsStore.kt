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

/** How the app reaches Claude. */
object EngineMode {
    const val EMBEDDED = "embedded" // in-process: app calls the Anthropic API directly
    const val REMOTE = "remote"     // via the external Omerta AI Node backend
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
            anthropicApiKey = p[Keys.ANTHROPIC_KEY]?.takeIf { it.isNotBlank() }
                ?: BuildConfig.ANTHROPIC_API_KEY,
            backendUrl = p[Keys.BACKEND_URL]?.takeIf { it.isNotBlank() } ?: BuildConfig.OMERTA_BACKEND_URL,
            appToken = p[Keys.APP_TOKEN] ?: "",
            model = p[Keys.MODEL] ?: DEFAULT_MODEL,
            systemPrompt = p[Keys.SYSTEM_PROMPT] ?: DEFAULT_SYSTEM,
            effort = p[Keys.EFFORT] ?: DEFAULT_EFFORT,
            streaming = p[Keys.STREAMING] ?: true,
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
    ) {
        context.dataStore.edit { p ->
            engineMode?.let { p[Keys.ENGINE_MODE] = it }
            anthropicApiKey?.let { p[Keys.ANTHROPIC_KEY] = it.trim() }
            backendUrl?.let { p[Keys.BACKEND_URL] = it.trim() }
            appToken?.let { p[Keys.APP_TOKEN] = it.trim() }
            model?.let { p[Keys.MODEL] = it }
            systemPrompt?.let { p[Keys.SYSTEM_PROMPT] = it }
            effort?.let { p[Keys.EFFORT] = it }
            streaming?.let { p[Keys.STREAMING] = it }
        }
    }
}
