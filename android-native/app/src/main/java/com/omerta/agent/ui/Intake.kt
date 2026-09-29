package com.omerta.agent.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What another app just handed over.
 *
 * The manifest has advertised OMERTA as a share target, and as a PROCESS_TEXT
 * handler, since the web build; the Compose rebuild left both accepted and
 * unhandled, which is worse than not offering them -- the share sheet listed
 * the app and then nothing happened. The Activity drops what it received here
 * and the console picks it up on its next composition.
 *
 * Text goes to the chat box rather than being sent: a share is the START of a
 * sentence ("summarise this", "what is wrong with this"), and sending it
 * straight to the model throws away the part the person was about to type.
 */
object Intake {

    private val _text = MutableStateFlow<String?>(null)
    val text: StateFlow<String?> = _text.asStateFlow()

    private val _files = MutableStateFlow<List<String>>(emptyList())
    val files: StateFlow<List<String>> = _files.asStateFlow()

    fun offerText(s: String?) {
        if (!s.isNullOrBlank()) _text.value = s
    }

    fun offerFiles(uris: List<String>) {
        if (uris.isNotEmpty()) _files.value = _files.value + uris
    }

    private val _dictate = MutableStateFlow(0)
    val dictate: StateFlow<Int> = _dictate.asStateFlow()

    /** The widget's SPEAK button, asking the chat box to open the recogniser. */
    fun requestDictation() {
        _dictate.value = _dictate.value + 1
    }

    private val _open = MutableStateFlow<String?>(null)
    val openPath: StateFlow<String?> = _open.asStateFlow()

    /**
     * A file the editor should open, from a trace in a reply.
     *
     * Carried as a plain path so the editor can resolve it the same way it
     * resolves anything else; the line number is not passed on, because the
     * editor is a single text field with no way to scroll to a line yet and
     * jumping to the wrong place is worse than not jumping.
     */
    fun requestOpen(path: String) {
        if (path.isNotBlank()) _open.value = path
    }

    fun takeOpen(): String? = _open.value.also { _open.value = null }

    /** Taken, so a rotation does not paste it a second time. */
    fun takeText(): String? = _text.value.also { _text.value = null }

    fun takeFiles(): List<String> = _files.value.also { _files.value = emptyList() }
}
