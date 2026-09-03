package com.hebsub.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.hebsub.core.provider.claude.ClaudeApi
import com.hebsub.core.subtitle.AssStyleOptions
import org.json.JSONObject

/**
 * All user configuration, including API keys. Keys are stored **encrypted at
 * rest** via Android Keystore-backed [EncryptedSharedPreferences]; they are
 * entered once by the user, never bundled in the app, never logged, and never
 * sent anywhere except the corresponding provider's own HTTPS endpoint.
 */
class SettingsRepository(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "hebsub_secure_settings",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var onboardingComplete: Boolean
        get() = prefs.getBoolean(KEY_ONBOARDED, false)
        set(v) = prefs.edit().putBoolean(KEY_ONBOARDED, v).apply()

    var openSubtitlesApiKey: String
        get() = prefs.getString(KEY_OS_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_OS_KEY, v.trim()).apply()

    var anthropicApiKey: String
        get() = prefs.getString(KEY_ANTHROPIC_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_ANTHROPIC_KEY, v.trim()).apply()

    var deepgramApiKey: String
        get() = prefs.getString(KEY_DEEPGRAM_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_DEEPGRAM_KEY, v.trim()).apply()

    var omdbApiKey: String
        get() = prefs.getString(KEY_OMDB_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_OMDB_KEY, v.trim()).apply()

    var claudeModel: String
        get() = prefs.getString(KEY_MODEL, ClaudeApi.DEFAULT_MODEL) ?: ClaudeApi.DEFAULT_MODEL
        set(v) = prefs.edit().putString(KEY_MODEL, v).apply()

    /**
     * The ASS look the user saved as their own default (spec §10). Null until they
     * tick "make these the defaults", after which every new styled track and every
     * newly opened editor starts from it instead of [AssStyleOptions.STYLED_DEFAULT].
     */
    var assDefaults: AssStyleOptions?
        get() = AssStyleOptions.deserialize(prefs.getString(KEY_ASS_DEFAULTS, null))
        set(v) = prefs.edit().apply {
            if (v == null) remove(KEY_ASS_DEFAULTS) else putString(KEY_ASS_DEFAULTS, v.serialize())
        }.apply()

    /** What a styled track starts from: the user's saved defaults, else the spec's. */
    val assStyleDefaults: AssStyleOptions get() = assDefaults ?: AssStyleOptions.STYLED_DEFAULT

    /**
     * Minimum time a subtitle stays on screen, in milliseconds (spec §8); 0 leaves
     * every cue exactly as its source timed it. A cue is only ever extended into
     * the silence before the next one — its start is never moved.
     */
    var minDisplayMs: Long
        get() = prefs.getLong(KEY_MIN_DISPLAY, 0L)
        set(v) = prefs.edit().putLong(KEY_MIN_DISPLAY, v.coerceIn(0L, MAX_MIN_DISPLAY_MS)).apply()

    val hasAnthropicKey: Boolean get() = anthropicApiKey.isNotBlank()
    val hasOpenSubtitlesKey: Boolean get() = openSubtitlesApiKey.isNotBlank()
    val hasDeepgramKey: Boolean get() = deepgramApiKey.isNotBlank()
    val hasOmdbKey: Boolean get() = omdbApiKey.isNotBlank()

    /**
     * Serialize the keys + model + online flag to a JSON backup the user can save
     * to a file and re-import after a reinstall (encrypted storage is wiped when
     * the app is uninstalled). The file holds the keys in plain text, so it must
     * be kept private — it never leaves the device on its own.
     */
    fun exportKeysJson(): String = JSONObject().apply {
        put(F_VERSION, 1)
        put(F_OS, openSubtitlesApiKey)
        put(F_ANTHROPIC, anthropicApiKey)
        put(F_DEEPGRAM, deepgramApiKey)
        put(F_OMDB, omdbApiKey)
        put(F_MODEL, claudeModel)
        assDefaults?.let { put(F_ASS, it.serialize()) }
        put(F_MIN_DISPLAY, minDisplayMs)
    }.toString(2)

    /**
     * Import keys from a JSON backup produced by [exportKeysJson]. Only non-blank
     * values overwrite existing settings, so a partial file never clears a key
     * that isn't in it. Returns how many API keys were applied.
     */
    fun importKeysJson(json: String): Int {
        val o = JSONObject(json)
        var applied = 0
        fun apply(field: String, set: (String) -> Unit) {
            val v = o.optString(field, "").trim()
            if (v.isNotEmpty()) { set(v); applied++ }
        }
        apply(F_OS) { openSubtitlesApiKey = it }
        apply(F_ANTHROPIC) { anthropicApiKey = it }
        apply(F_DEEPGRAM) { deepgramApiKey = it }
        apply(F_OMDB) { omdbApiKey = it }
        o.optString(F_MODEL, "").trim().takeIf { it.isNotEmpty() }?.let { claudeModel = it }
        AssStyleOptions.deserialize(o.optString(F_ASS, "").trim())?.let { assDefaults = it }
        if (o.has(F_MIN_DISPLAY)) minDisplayMs = o.optLong(F_MIN_DISPLAY, minDisplayMs)
        return applied
    }

    companion object {
        /** Upper bound for the §8 display-duration control (10 s). */
        const val MAX_MIN_DISPLAY_MS = 10_000L

        private const val KEY_ONBOARDED = "onboarded"
        private const val KEY_OS_KEY = "opensubtitles_key"
        private const val KEY_ANTHROPIC_KEY = "anthropic_key"
        private const val KEY_DEEPGRAM_KEY = "deepgram_key"
        private const val KEY_OMDB_KEY = "omdb_key"
        private const val KEY_MODEL = "claude_model"
        private const val KEY_ASS_DEFAULTS = "ass_defaults"
        private const val KEY_MIN_DISPLAY = "min_display_ms"

        // JSON field names for the keys backup file.
        private const val F_VERSION = "hebsub_keys_version"
        private const val F_OS = "opensubtitles"
        private const val F_ANTHROPIC = "anthropic"
        private const val F_DEEPGRAM = "deepgram"
        private const val F_OMDB = "omdb"
        private const val F_MODEL = "model"
        private const val F_ASS = "ass_defaults"
        private const val F_MIN_DISPLAY = "min_display_ms"
    }
}
