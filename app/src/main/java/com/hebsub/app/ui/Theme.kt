package com.hebsub.app.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/**
 * The app's look on the target device (spec §4 — a Galaxy A56).
 *
 * One UI 7 devices carry Material You, so on Android 12+ the palette is taken
 * from the user's own wallpaper colours and the app simply belongs on the phone.
 * Older devices fall back to a fixed teal scheme.
 *
 * The dark scheme is deliberately near-black rather than Material's dark grey:
 * the A56's screen is AMOLED, so true black pixels are switched off — which both
 * saves power and gives the contrast that matters when the app is used beside a
 * film that is itself playing in the dark.
 */
private val AmoledBlack = Color(0xFF000000)
private val AmoledSurface = Color(0xFF0B0B0C)
private val AmoledSurfaceHigh = Color(0xFF17181A)

private val LightScheme = lightColorScheme(
    primary = Color(0xFF00696E),
    secondary = Color(0xFF4A6365),
    tertiary = Color(0xFF4F5F7D),
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFF4FD8DF),
    secondary = Color(0xFFB1CBCD),
    tertiary = Color(0xFFB7C7E9),
    background = AmoledBlack,
    surface = AmoledBlack,
    surfaceContainer = AmoledSurface,
    surfaceContainerHigh = AmoledSurfaceHigh,
    surfaceContainerHighest = AmoledSurfaceHigh,
)

@Composable
fun HebSubTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            // Material You, then pushed to true black so a dark room stays dark.
            if (darkTheme) {
                dynamicDarkColorScheme(context).copy(
                    background = AmoledBlack,
                    surface = AmoledBlack,
                    surfaceContainer = AmoledSurface,
                    surfaceContainerHigh = AmoledSurfaceHigh,
                )
            } else dynamicLightColorScheme(context)
        darkTheme -> DarkScheme
        else -> LightScheme
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
