package com.hebsub.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.hebsub.core.provider.claude.ClaudeApi

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

    var onlineSearchEnabled: Boolean
        get() = prefs.getBoolean(KEY_ONLINE, true)
        set(v) = prefs.edit().putBoolean(KEY_ONLINE, v).apply()

    var openSubtitlesApiKey: String
        get() = prefs.getString(KEY_OS_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_OS_KEY, v.trim()).apply()

    var anthropicApiKey: String
        get() = prefs.getString(KEY_ANTHROPIC_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_ANTHROPIC_KEY, v.trim()).apply()

    var deepgramApiKey: String
        get() = prefs.getString(KEY_DEEPGRAM_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_DEEPGRAM_KEY, v.trim()).apply()

    var claudeModel: String
        get() = prefs.getString(KEY_MODEL, ClaudeApi.DEFAULT_MODEL) ?: ClaudeApi.DEFAULT_MODEL
        set(v) = prefs.edit().putString(KEY_MODEL, v).apply()

    val hasAnthropicKey: Boolean get() = anthropicApiKey.isNotBlank()
    val hasOpenSubtitlesKey: Boolean get() = openSubtitlesApiKey.isNotBlank()
    val hasDeepgramKey: Boolean get() = deepgramApiKey.isNotBlank()

    private companion object {
        const val KEY_ONBOARDED = "onboarded"
        const val KEY_ONLINE = "online_search"
        const val KEY_OS_KEY = "opensubtitles_key"
        const val KEY_ANTHROPIC_KEY = "anthropic_key"
        const val KEY_DEEPGRAM_KEY = "deepgram_key"
        const val KEY_MODEL = "claude_model"
    }
}
