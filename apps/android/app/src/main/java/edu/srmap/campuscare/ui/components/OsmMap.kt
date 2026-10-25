package edu.srmap.campuscare.ui.components

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.BitmapDrawable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polygon
import org.osmdroid.views.overlay.mylocation.GpsMyLocationProvider
import org.osmdroid.views.overlay.mylocation.MyLocationNewOverlay

data class MapPin(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val title: String,
    val snippet: String? = null,
    val color: Color,
    val label: String = "",
)

data class HeatSpot(val latitude: Double, val longitude: Double, val radiusMeters: Double, val intensity: Float)

/**
 * OpenStreetMap view (no API key needed) with coloured pins, privacy-preserving heat circles and
 * an optional "my location" dot (shown only when location permission was granted).
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
    onPinClick: (MapPin) -> Unit = {},
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val map = remember {
        MapView(context).apply {
            setTileSource(TileSourceFactory.MAPNIK)
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
        if (showMyLocation) {
            val me = MyLocationNewOverlay(GpsMyLocationProvider(view.context), view)
            me.enableMyLocation()
            view.overlays.add(me)
        }
        view.invalidate()
    })
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
