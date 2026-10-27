package edu.srmap.campuscare.ui.components

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.BitmapDrawable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.util.Fix
import edu.srmap.campuscare.util.ageSeconds
import edu.srmap.campuscare.util.rememberLiveFix
import org.osmdroid.tileprovider.tilesource.ITileSource
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.tileprovider.tilesource.XYTileSource
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.CopyrightOverlay
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polygon

data class MapPin(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val title: String,
    val snippet: String? = null,
    val color: Color,
    val label: String = "",
)

/**
 * A measured position drawn with its reported uncertainty. [measured] = raw device GPS; never set it
 * for a map-matched or estimated point (those are drawn dashed and labelled as estimates).
 */
data class AccuracyCircle(val latitude: Double, val longitude: Double, val radiusMeters: Double, val color: Color, val measured: Boolean = true)

/**
 * Tile source from build config (campuscare.mapTileUrl). Empty = OpenStreetMap standard tiles,
 * which are fine for light use with attribution; heavy/production use needs a licensed tile host.
 * Tiles are cached only by osmdroid's normal on-demand cache — never bulk-downloaded.
 */
private fun tileSource(): ITileSource {
    val url = BuildConfig.MAP_TILE_URL.trim()
    if (url.isEmpty() || !url.contains("{z}")) return TileSourceFactory.MAPNIK
    val base = url.substringBefore("{z}")
    val ext = url.substringAfterLast("{y}").removePrefix(".").ifBlank { "png" }
    return object : XYTileSource("CampusCareTiles", 0, 19, 256, ".$ext", arrayOf(base), BuildConfig.MAP_ATTRIBUTION) {}
}

data class HeatSpot(val latitude: Double, val longitude: Double, val radiusMeters: Double, val intensity: Float)

/** Device-location dot colour: distinct from every building/facility pin colour. */
private val MyLocationBlue = Color(0xFF1A73E8)

/**
 * OpenStreetMap view (no API key needed) with coloured pins, privacy-preserving heat circles and
 * an optional "my location" dot (shown only when location permission was granted).
 *
 * The dot is the app's own fused high-accuracy fix (same source and outlier filter as SOS), drawn at
 * the measured coordinates with its accuracy ring. It is never snapped to a building. osmdroid's
 * MyLocationNewOverlay is deliberately not used: its GpsMyLocationProvider shows raw "network"
 * provider fixes whenever GPS has no lock (typical indoors), which are often 50–200 m off and put
 * the dot on a neighbouring block.
 */
@Composable
fun OsmMap(
    centerLat: Double,
    centerLng: Double,
    zoom: Double,
    pins: List<MapPin>,
    modifier: Modifier = Modifier,
    heat: List<HeatSpot> = emptyList(),
    showMyLocation: Boolean = false,
    route: List<Pair<Double, Double>> = emptyList(),
    circles: List<AccuracyCircle> = emptyList(),
    onPinClick: (MapPin) -> Unit = {},
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val live by rememberLiveFix(enabled = showMyLocation)
    val map = remember {
        MapView(context).apply {
            setTileSource(tileSource())
            setMultiTouchControls(true)
            zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
            controller.setZoom(zoom)
            controller.setCenter(GeoPoint(centerLat, centerLng))
            isTilesScaledToDpi = true
        }
    }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> map.onResume()
                Lifecycle.Event.ON_PAUSE -> map.onPause()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            map.onDetach()
        }
    }
    AndroidView(factory = { map }, modifier = modifier, update = { view ->
        view.overlays.clear()
        heat.forEach { h ->
            val circle = Polygon(view).apply {
                setPoints(Polygon.pointsAsCircle(GeoPoint(h.latitude, h.longitude), h.radiusMeters))
                val alpha = (40 + 120 * h.intensity).toInt().coerceIn(30, 170)
                fillPaint.color = android.graphics.Color.argb(alpha, 220, 38, 38)
                outlinePaint.color = android.graphics.Color.argb(0, 0, 0, 0)
                outlinePaint.strokeWidth = 0f
                setOnClickListener { _, _, _ -> true }
            }
            view.overlays.add(circle)
        }
        circles.forEach { c ->
            val ring = Polygon(view).apply {
                setPoints(Polygon.pointsAsCircle(GeoPoint(c.latitude, c.longitude), c.radiusMeters.coerceAtLeast(3.0)))
                fillPaint.color = c.color.copy(alpha = 0.16f).toArgb()
                outlinePaint.color = c.color.copy(alpha = 0.6f).toArgb()
                outlinePaint.strokeWidth = 3f
                if (!c.measured) outlinePaint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(14f, 10f), 0f)
                setOnClickListener { _, _, _ -> true }
            }
            view.overlays.add(ring)
        }
        if (route.size >= 2) {
            val line = org.osmdroid.views.overlay.Polyline(view).apply {
                setPoints(route.map { GeoPoint(it.first, it.second) })
                outlinePaint.color = Color(0xFF0D9488).toArgb()
                outlinePaint.strokeWidth = 10f
            }
            view.overlays.add(line)
        }
        pins.forEach { p ->
            val m = Marker(view).apply {
                position = GeoPoint(p.latitude, p.longitude)
                title = p.title
                snippet = p.snippet
                icon = pinDrawable(view, p.color.toArgb(), p.label)
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                setOnMarkerClickListener { marker, _ ->
                    onPinClick(p)
                    marker.showInfoWindow()
                    true
                }
            }
            view.overlays.add(m)
        }
        // Attribution required by OpenStreetMap's licence (and most tile hosts).
        view.overlays.add(CopyrightOverlay(view.context).apply { setCopyrightNotice(BuildConfig.MAP_ATTRIBUTION) })
        val fix = live?.raw
        if (showMyLocation && fix != null) {
            // Measured position, not the smoothed estimate or a building centre. A stale fix stays visible
            // but is drawn grey with a dashed ring so it is not mistaken for where the person is now.
            val stale = fix.ageSeconds() > Fix.STALE_SECONDS
            val tint = if (stale) Color(0xFF9AA0A6) else MyLocationBlue
            val here = GeoPoint(fix.latitude, fix.longitude)
            fix.accuracyMeters?.let { acc ->
                view.overlays.add(Polygon(view).apply {
                    setPoints(Polygon.pointsAsCircle(here, acc.coerceAtLeast(3.0)))
                    fillPaint.color = tint.copy(alpha = 0.14f).toArgb()
                    outlinePaint.color = tint.copy(alpha = 0.55f).toArgb()
                    outlinePaint.strokeWidth = 3f
                    if (stale) outlinePaint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(14f, 10f), 0f)
                    setOnClickListener { _, _, _ -> true }
                })
            }
            view.overlays.add(Marker(view).apply {
                position = here
                title = "Your location"
                snippet = (fix.accuracyMeters?.let { "±${it.toInt().coerceAtLeast(1)} m" } ?: "accuracy unknown") + if (stale) " · stale" else ""
                icon = dotDrawable(view, tint.toArgb())
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
            })
        }
        view.invalidate()
    })
}

/** Round "you are here" dot with a white rim, visually distinct from teardrop building pins. */
private fun dotDrawable(view: MapView, color: Int): BitmapDrawable {
    val d = view.context.resources.displayMetrics.density
    val size = (20 * d).toInt()
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = android.graphics.Color.WHITE }
    val r = size / 2f
    c.drawCircle(r, r, r - d, paint)
    paint.color = color
    c.drawCircle(r, r, r - 4 * d, paint)
    return BitmapDrawable(view.resources, bmp)
}

/** Teardrop pin with a one-letter label, rendered to a bitmap for osmdroid. */
private fun pinDrawable(view: MapView, color: Int, label: String): BitmapDrawable {
    val d = view.context.resources.displayMetrics.density
    val w = (34 * d).toInt()
    val h = (44 * d).toInt()
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
    val r = w / 2f
    c.drawCircle(r, r, r - 2 * d, paint)
    val path = android.graphics.Path().apply {
        moveTo(r - r * 0.55f, r + r * 0.6f)
        lineTo(r, h.toFloat() - 2 * d)
        lineTo(r + r * 0.55f, r + r * 0.6f)
        close()
    }
    c.drawPath(path, paint)
    paint.color = android.graphics.Color.WHITE
    c.drawCircle(r, r, r * 0.55f, paint)
    if (label.isNotEmpty()) {
        paint.color = color
        paint.textSize = 13 * d
        paint.isFakeBoldText = true
        paint.textAlign = Paint.Align.CENTER
        c.drawText(label.take(1), r, r + 4.5f * d, paint)
    }
    return BitmapDrawable(view.resources, bmp)
}
