package edu.srmap.campuscare.util

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

/** Opens the dialer pre-filled. The person confirms the call themselves (no CALL_PHONE permission). */
fun Context.dial(number: String) {
    val clean = number.filter { it.isDigit() || it == '+' }
    try {
        startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$clean")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(this, "No phone app available. Dial $clean manually.", Toast.LENGTH_LONG).show()
    }
}

/** Offline fallback: pre-composes an SMS the person can send to their trusted contacts. */
fun Context.composeSms(numbers: List<String>, body: String) {
    val to = numbers.joinToString(";") { n -> n.filter { it.isDigit() || it == '+' } }
    try {
        startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$to")).putExtra("sms_body", body).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(this, "No messaging app available.", Toast.LENGTH_LONG).show()
    }
}

fun Context.openUrl(url: String) {
    try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(this, "No browser available.", Toast.LENGTH_LONG).show()
    }
}

fun Context.shareText(subject: String, text: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, subject).putExtra(Intent.EXTRA_TEXT, text)
    startActivity(Intent.createChooser(send, subject).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
