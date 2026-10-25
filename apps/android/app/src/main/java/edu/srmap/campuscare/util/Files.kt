package edu.srmap.campuscare.util

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import edu.srmap.campuscare.data.ApiException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class PickedFile(val bytes: ByteArray, val name: String, val mime: String) {
    val size: Long get() = bytes.size.toLong()
}

/**
 * Reads a file the person picked with the system picker. Enforces [maxBytes] before the upload so
 * a large file fails fast with a clear message (the server enforces the same limit again).
 */
suspend fun readPicked(context: Context, uri: Uri, maxBytes: Long): PickedFile = withContext(Dispatchers.IO) {
    val cr = context.contentResolver
    var name = "attachment"
    var declaredSize = -1L
    cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
            c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { i -> c.getString(i)?.let { name = it } }
            c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { i -> if (!c.isNull(i)) declaredSize = c.getLong(i) }
        }
    }
    if (declaredSize > maxBytes) throw ApiException(-1, "too_large", "That file is larger than ${Fmt.bytes(maxBytes)}.")
    val mime = cr.getType(uri) ?: "application/octet-stream"
    val bytes = cr.openInputStream(uri)?.use { it.readBytes() } ?: throw ApiException(-1, "read_failed", "Could not read that file.")
    if (bytes.size > maxBytes) throw ApiException(-1, "too_large", "That file is larger than ${Fmt.bytes(maxBytes)}.")
    PickedFile(bytes, name.take(120), mime)
}
