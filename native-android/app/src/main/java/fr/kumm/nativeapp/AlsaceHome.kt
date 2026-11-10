package fr.kumm.nativeapp

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

internal val bricolage = FontFamily(
    Font(R.font.bricolage_400, FontWeight.Normal),
    Font(R.font.bricolage_600, FontWeight.SemiBold),
    Font(R.font.bricolage_800, FontWeight.ExtraBold)
)

internal data class AlsacePalette(
    val sky: Color, val draw: Color, val card: Color, val muted: Color, val line: Color, val nav: Color
)

internal val alsaceDay = AlsacePalette(Color(0xFFF3E9E1), Color(0xFFB23A2B), Color.White,
    Color(0xFF6F625B), Color(0xFFECE4DC), Color.White)
internal val alsaceNight = AlsacePalette(Color(0xFF201714), Color(0xFFE8745F), Color(0xFF221A17),
    Color(0xFFB3A49B), Color(0xFF3A2E29), Color(0xFF1C1512))
internal val LocalAlsace = staticCompositionLocalOf { alsaceDay }

internal enum class Tab(val title: String, @param:DrawableRes val icon: Int) {
    HOME("Accueil", R.drawable.alsace_home), SEARCH("Recherche", R.drawable.alsace_search), MAP("Carte", R.drawable.alsace_pin)
}

@Composable
internal fun AlsaceTabs(current: Tab, select: (Tab) -> Unit) {
    val palette = LocalAlsace.current
    Column(Modifier.fillMaxWidth().background(palette.nav)) {
        HorizontalDivider(color = palette.line)
        Row(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).selectableGroup()
            .padding(horizontal = 6.dp)) {
            Tab.entries.forEach { tab ->
                val selected = current == tab
                val tint = if (selected) MaterialTheme.colorScheme.primary else palette.muted
                Column(Modifier.weight(1f).selectable(selected, role = Role.Tab, onClick = { select(tab) })
                    .padding(vertical = 7.dp), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    AlsaceIcon(tab.icon, null, tint, 25)
                    Text(tab.title, fontFamily = bricolage, fontWeight = FontWeight.SemiBold,
                        fontSize = 11.sp, color = tint)
                }
            }
        }
    }
}

@Composable
internal fun AlsaceHome(
    demo: Boolean, info: Load<HomeInfo>, home: Stop?, work: Stop?, favourites: List<Stop>,
    search: () -> Unit, place: (Boolean) -> Unit, addFavourite: () -> Unit, openStop: (Stop) -> Unit,
    traffic: () -> Unit, bike: () -> Unit, settings: () -> Unit, account: () -> Unit, openLine: (String) -> Unit
) {
    val list = rememberLazyListState()
    val threshold = with(LocalDensity.current) { 60.dp.roundToPx() }
    val collapsed by remember(list, threshold) {
        derivedStateOf { list.firstVisibleItemIndex > 0 || list.firstVisibleItemScrollOffset > threshold }
    }
    Column(Modifier.fillMaxSize()) {
        AlsaceHeader(collapsed, demo, traffic, settings, account)
        LazyColumn(
            state = list, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Tile(click = search) {
                    TileLabel(R.drawable.alsace_navigate, "Naviguer", MaterialTheme.colorScheme.primary)
                    TileTitle("Où on va ?")
                    TileNote("Trouve un arrêt et consulte les départs en tram, bus ou TER.")
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PlaceTile(Modifier.weight(1f), true, home, place)
                    PlaceTile(Modifier.weight(1f), false, work, place)
                }
            }
            item {
                Tile(dashed = favourites.isEmpty(), click = addFavourite) {
                    TileLabel(R.drawable.alsace_star, "Vos arrêts")
                    if (favourites.isEmpty()) TileNote("Ajoutez vos arrêts favoris pour retrouver leurs prochains passages.")
                    else Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        favourites.forEach { stop ->
                            Text(stop.name, Modifier.clickable(role = Role.Button) { openStop(stop) }.padding(vertical = 6.dp),
                                color = MaterialTheme.colorScheme.primary, fontFamily = bricolage, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
            item {
                val data = info.value
                val alert = data?.traffic?.firstOrNull()
                val alertColor = if (MaterialTheme.colorScheme.background == alsaceNightBackground) Color(0xFFFF6B5E) else Color(0xFFD63A2F)
                val bikeColor = if (MaterialTheme.colorScheme.background == alsaceNightBackground) Color(0xFF9BC76A) else Color(0xFF4E8A12)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Tile(Modifier.weight(1f), click = traffic) {
                        TileLabel(R.drawable.alsace_bell, "Info trafic" + (data?.traffic?.size?.let { " · $it" } ?: ""), alertColor, alertColor)
                        if (alert != null) {
                            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                alert.lines.take(2).forEach { LineChip(it, compact = true) }
                            }
                            TileTitle(alert.title, 15)
                        } else TileNote(if (data?.traffic != null) "Aucune perturbation signalée" else "Infos CTS indisponibles")
                    }
                    Tile(Modifier.weight(1f), click = bike) {
                        TileLabel(R.drawable.alsace_bike, "Vélhop", bikeColor, bikeColor)
                        val station = data?.bike
                        if (station != null) {
                            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TileTitle(station.bikes.toString(), 26)
                                Text("vélos", Modifier.padding(bottom = 2.dp), color = LocalAlsace.current.muted)
                            }
                            TileNote(station.name)
                        } else TileNote("Disponibilité des vélos indisponible")
                    }
                }
            }
            item {
                Tile {
                    TileLabel(R.drawable.alsace_tram, "Toutes les lignes")
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        dataLines.forEach { line -> LineChip(line, click = { openLine(line) }) }
                    }
                }
            }
            if (demo) item {
                Text("Kumm natif · Démonstration, données simulées", Modifier.padding(vertical = 5.dp),
                    fontSize = 12.sp, color = LocalAlsace.current.muted, fontFamily = bricolage)
            }
        }
    }
}

private val dataLines = listOf("A", "B", "C", "D", "E", "F", "G", "H", "TER")
internal val alsaceNightBackground = Color(0xFF17110F)

@Composable
private fun AlsaceHeader(collapsed: Boolean, demo: Boolean, traffic: () -> Unit, settings: () -> Unit, account: () -> Unit) {
    val now = ZonedDateTime.now(ZoneId.of("Europe/Paris"))
    val greeting = when (now.hour) {
        in 5..10 -> "Güete Morje"
        in 11..17 -> "Salü"
        else -> "Güete Owe"
    }
    val date = now.format(DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.FRANCE))
        .replaceFirstChar { it.titlecase(Locale.FRANCE) }
    val height by animateDpAsState(if (collapsed) 0.dp else 96.dp, label = "Illustration Alsace")
    val palette = LocalAlsace.current
    val accent = MaterialTheme.colorScheme.primary
    Column(Modifier.fillMaxWidth().background(palette.sky).padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(if (demo) "$date · Démo" else date, Modifier.weight(1f), color = palette.muted, fontFamily = bricolage,
                fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            IconButton(onClick = traffic) { AlsaceIcon(R.drawable.alsace_mail, "Messages", accent, 22) }
            IconButton(onClick = settings) { AlsaceIcon(R.drawable.alsace_sliders, "Réglages", accent, 22) }
            IconButton(onClick = account) { AlsaceIcon(R.drawable.alsace_user, "Compte", accent, 22) }
        }
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            Text(buildAnnotatedString {
                append(greeting)
                withStyle(SpanStyle(color = accent)) { append(" !") }
            }, fontFamily = bricolage, fontWeight = FontWeight.ExtraBold,
                fontSize = (if (collapsed) 26f else (maxWidth.value * .094f).coerceIn(25f, 40f)).sp,
                letterSpacing = (-.5).sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (height > 0.dp) {
            Image(painterResource(R.drawable.alsace_town), null,
                Modifier.fillMaxWidth().padding(top = 4.dp).height(height), alignment = Alignment.BottomCenter,
                contentScale = ContentScale.Fit, colorFilter = ColorFilter.tint(palette.draw))
        }
    }
}

@Composable
private fun PlaceTile(modifier: Modifier, isHome: Boolean, stop: Stop?, edit: (Boolean) -> Unit) {
    Tile(modifier, dashed = stop == null, click = { edit(isHome) }) {
        TileLabel(if (isHome) R.drawable.alsace_home else R.drawable.alsace_store,
            if (isHome) "Maison" else "Boulot", MaterialTheme.colorScheme.primary)
        TileTitle(stop?.name ?: "Ajouter", 20)
        TileNote(if (stop != null) "Arrêt enregistré" else if (isHome) "Votre arrêt près de la maison" else "Votre arrêt près du boulot")
    }
}

@Composable
private fun Tile(modifier: Modifier = Modifier, dashed: Boolean = false, click: (() -> Unit)? = null,
    content: @Composable () -> Unit) {
    val palette = LocalAlsace.current
    val shape = RoundedCornerShape(16.dp)
    Box(modifier.clip(shape).then(if (click == null) Modifier else Modifier.clickable(role = Role.Button, onClick = click))) {
        if (dashed) {
            Canvas(Modifier.matchParentSize()) {
                val stroke = 1.5.dp.toPx()
                val radius = 16.dp.toPx()
                drawRoundRect(palette.line, topLeft = Offset(stroke / 2, stroke / 2),
                    size = Size(size.width - stroke, size.height - stroke), cornerRadius = CornerRadius(radius),
                    style = Stroke(stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.dp.toPx()))))
            }
        }
        Column(Modifier.fillMaxWidth().then(if (dashed) Modifier else Modifier.background(palette.card))
            .padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            content()
        }
    }
}

@Composable
private fun TileLabel(@DrawableRes icon: Int, label: String, iconColor: Color = LocalAlsace.current.muted,
    textColor: Color = LocalAlsace.current.muted) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        AlsaceIcon(icon, null, iconColor, 16)
        Text(label, fontSize = 13.sp, fontFamily = bricolage, fontWeight = FontWeight.SemiBold, color = textColor)
    }
}

@Composable
private fun TileTitle(text: String, size: Int = 22) {
    Text(text, fontSize = size.sp, lineHeight = (size + 3).sp, fontFamily = bricolage,
        fontWeight = FontWeight.ExtraBold, letterSpacing = (-.3).sp, color = MaterialTheme.colorScheme.onSurface)
}

@Composable
private fun TileNote(text: String) {
    Text(text, color = LocalAlsace.current.muted, fontFamily = bricolage, fontSize = 14.sp, lineHeight = 19.sp)
}

@Composable
internal fun AlsaceIcon(@DrawableRes icon: Int, description: String?, tint: Color, size: Int) {
    Icon(painterResource(icon), description, Modifier.size(size.dp), tint = tint)
}

private val lineColors = mapOf("A" to 0xFFE10D19, "B" to 0xFF009EE0, "C" to 0xFFF29400, "D" to 0xFF009933,
    "E" to 0xFF9085BA, "F" to 0xFF97BF0D, "G" to 0xFFF6C900, "H" to 0xFFA62341, "TER" to 0xFF7B1FA2,
    "N3" to 0xFF2D3E58, "C4" to 0xFFF08118)

@Composable
internal fun LineChip(line: String, compact: Boolean = false, click: (() -> Unit)? = null) {
    val shape = RoundedCornerShape(7.dp)
    Surface(
        modifier = Modifier.clip(shape).then(if (click == null) Modifier else Modifier.clickable(role = Role.Button, onClickLabel = "Voir la ligne $line", onClick = click)),
        shape = shape, color = lineColors[line]?.let(::Color) ?: LocalAlsace.current.line
    ) {
        Box(Modifier.padding(horizontal = if (compact) 6.dp else 9.dp, vertical = if (compact) 3.dp else 6.dp),
            contentAlignment = Alignment.Center) {
            Text(line, fontSize = (if (compact) 13 else 18).sp, fontFamily = bricolage,
                color = when {
                    line == "G" -> Color.Black
                    line in lineColors -> Color.White
                    else -> MaterialTheme.colorScheme.onSurface
                }, fontWeight = FontWeight.ExtraBold)
        }
    }
}
