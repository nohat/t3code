package expo.modules.t3nativecontrols

import android.content.Intent
import android.text.format.DateFormat
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URI

class T3NativeControlsModule : Module() {
  private var filePreviewPromise: Promise? = null

  @Suppress("TooGenericExceptionCaught") // Clear the pending promise before rethrowing.
  override fun definition() = ModuleDefinition {
    Name("T3NativeControls")

    // Package resources and PackageInfo belong to the installed APK, not an OTA manifest.
    Function("getAboutMetadata") {
      val context = appContext.reactContext ?: error("The app is not active.")
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      fun resource(name: String): String {
        val id = context.resources.getIdentifier(name, "string", context.packageName)
        return if (id == 0) "" else context.getString(id)
      }
      mapOf(
        "version" to (info.versionName ?: ""),
        "build" to androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(info).toString(),
        "builtAtUTC" to resource("t3_about_built_at_utc"),
        "copyright" to resource("t3_about_copyright"),
        "variant" to resource("t3_about_variant")
      )
    }

    Function("is24HourFormat") {
      val context = appContext.reactContext ?: error("The app is not active.")
      DateFormat.is24HourFormat(context)
    }

    AsyncFunction("openFile") { uri: String, mimeType: String, promise: Promise ->
      check(filePreviewPromise == null) { "A document viewer is already open." }
      val activity = appContext.currentActivity ?: error("The app is not active.")
      val file = File(URI(uri)).canonicalFile
      require(file.isFile) { "The file is no longer available." }
      val contentUri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.FileSystemFileProvider",
        file
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, mimeType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      filePreviewPromise = promise
      try {
        activity.startActivityForResult(intent, 7343)
      } catch (error: Exception) {
        filePreviewPromise = null
        throw error
      }
    }

    OnActivityResult { _, (requestCode) ->
      if (requestCode == 7343) {
        filePreviewPromise?.resolve(null)
        filePreviewPromise = null
      }
    }

    Function("getShowcasePairingUrl") {
      appContext.currentActivity?.intent?.getStringExtra("showcasePairingUrl")
    }

    Function("getShowcaseScene") {
      val storedScene = appContext.reactContext
        ?.filesDir
        ?.resolve("t3-showcase-scene")
        ?.takeIf { it.isFile }
        ?.readText()
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
      storedScene ?: appContext.currentActivity?.intent?.getStringExtra("showcaseScene")
    }

    // The palette is fixed for the whole capture, so it only ever arrives as a
    // launch extra — unlike the scene, which the runner rewrites in place.
    Function("getShowcaseTheme") {
      appContext.currentActivity?.intent?.getStringExtra("showcaseTheme")
    }

    Function("prepareShowcaseCapture") {
      // Android app data is cleared by the host runner before launch.
    }

    Function("markShowcaseReady") { scene: String ->
      appContext.reactContext
        ?.filesDir
        ?.resolve("t3-showcase-ready")
        ?.writeText(scene)
    }
  }
}
