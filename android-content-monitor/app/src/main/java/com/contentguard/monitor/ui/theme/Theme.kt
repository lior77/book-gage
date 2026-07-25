package com.contentguard.monitor.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Indigo = Color(0xFF1A237E)
private val IndigoLight = Color(0xFF3949AB)

private val LightColors = lightColorScheme(
    primary = Indigo,
    secondary = IndigoLight
)

private val DarkColors = darkColorScheme(
    primary = IndigoLight,
    secondary = Indigo
)

@Composable
fun ContentGuardTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(colorScheme = colors, content = content)
}
