package br.com.huse.mapainterno

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.Locale
import kotlin.math.min

class MainActivity : Activity(), SensorEventListener {
    private lateinit var webView: WebView
    private lateinit var sensorManager: SensorManager
    private lateinit var assetLoader: WebViewAssetLoader
    private val registeredSensors = mutableSetOf<Int>()
    private var trackingActive = false
    private var stepsWanted = false
    private var permissionRequestPending = false
    private var stepCounterLast: Float? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingJson: String? = null

    private val stepDetector: Sensor? by lazy { sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR) }
    private val stepCounter: Sensor? by lazy { sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) }
    private val rotationSensor: Sensor? by lazy { sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installCrashRecorder()
        val crashPrefs = getSharedPreferences(CRASH_PREFS, MODE_PRIVATE)
        val previousCrash = crashPrefs.getString(CRASH_KEY, null)
        if (!previousCrash.isNullOrBlank()) {
            crashPrefs.edit().remove(CRASH_KEY).commit()
            showStartupDiagnostic("O app encerrou na abertura anterior. Diagnóstico salvo:", previousCrash)
            return
        }
        try {
            initializeApp()
        } catch (error: Throwable) {
            showStartupDiagnostic("Falha ao inicializar o aplicativo:", Log.getStackTraceString(error))
        }
    }

    private fun initializeApp() {
        requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        window.statusBarColor = android.graphics.Color.rgb(18, 59, 50)
        window.navigationBarColor = android.graphics.Color.rgb(18, 59, 50)
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this)
        webView.setBackgroundColor(android.graphics.Color.WHITE)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = true
        webView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        webView.settings.javaScriptCanOpenWindowsAutomatically = false
        webView.addJavascriptInterface(NativeSensorsBridge(), "AndroidSensors")
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host != "appassets.androidplatform.net") {
                    return WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
                }
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "appassets.androidplatform.net"
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "application/json"
                }
                return try {
                    startActivityForResult(intent, REQUEST_FILE)
                    true
                } catch (_: Exception) {
                    fileChooserCallback = null
                    false
                }
            }
        }
        setContentView(webView, FrameLayout.LayoutParams(-1, -1))
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    private fun installCrashRecorder() {
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                getSharedPreferences(CRASH_PREFS, MODE_PRIVATE).edit()
                    .putString(CRASH_KEY, Log.getStackTraceString(error)).commit()
            } catch (_: Throwable) {
            }
            if (previousHandler != null) previousHandler.uncaughtException(thread, error)
            else android.os.Process.killProcess(android.os.Process.myPid())
        }
    }

    private fun showStartupDiagnostic(title: String, details: String) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 32, 24, 24)
            setBackgroundColor(android.graphics.Color.WHITE)
        }
        val heading = TextView(this).apply {
            text = title
            textSize = 20f
            setTextColor(android.graphics.Color.rgb(18, 59, 50))
        }
        val scroll = ScrollView(this)
        val diagnostic = TextView(this).apply {
            text = details
            textSize = 13f
            setTextColor(android.graphics.Color.DKGRAY)
            textIsSelectable = true
            setPadding(0, 20, 0, 20)
        }
        scroll.addView(diagnostic)
        val copy = Button(this).apply {
            text = "Copiar diagnóstico"
            setOnClickListener {
                val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Diagnóstico do app", details))
                text = "Diagnóstico copiado"
            }
        }
        root.addView(heading)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(copy)
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        if (trackingActive && !permissionRequestPending) registerTrackingSensors()
    }

    override fun onPause() {
        stepCounterLast = null
        unregisterSensors()
        super.onPause()
    }

    override fun onDestroy() {
        trackingActive = false
        unregisterSensors()
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("AndroidSensors")
            webView.destroy()
        }
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private fun hasRecognitionPermission(): Boolean =
        Build.VERSION.SDK_INT < 29 || checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

    private fun startTrackingOnUi(useStepSensor: Boolean) {
        trackingActive = true
        stepsWanted = useStepSensor
        stepCounterLast = null
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        registerTrackingSensors()
    }

    private fun registerTrackingSensors() {
        if (!trackingActive || !::sensorManager.isInitialized) return
        registerSensor(rotationSensor, SensorManager.SENSOR_DELAY_GAME)
        if (!stepsWanted) {
            reportStatus("Orientação do Android ativa; contagem automática de passos desligada.")
            return
        }
        if (!hasRecognitionPermission()) {
            if (!permissionRequestPending) {
                permissionRequestPending = true
                requestPermissions(arrayOf(Manifest.permission.ACTIVITY_RECOGNITION), REQUEST_RECOGNITION)
            }
            reportStatus("Autorize a atividade física para o Android contar passos automaticamente.")
            return
        }
        val detector = stepDetector
        val counter = stepCounter
        if (detector == null && counter == null) {
            reportStatus("Este aparelho não disponibilizou um sensor nativo de passos. O percurso não contará passos automaticamente.")
            return
        }
        val sensor = detector ?: counter
        if (sensor != null) {
            registerSensor(sensor, SensorManager.SENSOR_DELAY_NORMAL)
            reportStatus(if (stepDetector != null) "Sensor nativo de passos ativo." else "Sensor de passos ativo; este aparelho pode atualizar a contagem com atraso.")
        }
    }

    private fun registerSensor(sensor: Sensor?, delay: Int) {
        if (sensor == null || registeredSensors.contains(sensor.type)) return
        if (sensorManager.registerListener(this, sensor, delay)) registeredSensors.add(sensor.type)
    }

    private fun unregisterSensors() {
        if (!::sensorManager.isInitialized) return
        sensorManager.unregisterListener(this)
        registeredSensors.clear()
    }

    private fun stopTrackingOnUi() {
        trackingActive = false
        stepsWanted = false
        permissionRequestPending = false
        stepCounterLast = null
        unregisterSensors()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_RECOGNITION) return
        permissionRequestPending = false
        if (!trackingActive || !stepsWanted) return
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            registerTrackingSensors()
        } else {
            reportStatus("Sem essa permissão, o Android não libera a contagem automática de passos. Você pode continuar com o registro manual.")
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!trackingActive) return
        when (event.sensor.type) {
            Sensor.TYPE_STEP_DETECTOR -> if (stepsWanted && event.values.isNotEmpty() && event.values[0] >= 1f) reportStep()
            Sensor.TYPE_STEP_COUNTER -> if (stepsWanted && event.values.isNotEmpty()) {
                val current = event.values[0]
                val previous = stepCounterLast
                stepCounterLast = current
                if (previous != null) {
                    val delta = (current - previous).toInt()
                    repeat(min(delta.coerceAtLeast(0), 20)) { reportStep() }
                }
            }
            Sensor.TYPE_ROTATION_VECTOR -> {
                val rotationMatrix = FloatArray(9)
                val orientation = FloatArray(3)
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                SensorManager.getOrientation(rotationMatrix, orientation)
                val degrees = (Math.toDegrees(orientation[0].toDouble()) + 360.0) % 360.0
                reportHeading(degrees)
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        if (sensor?.type == Sensor.TYPE_ROTATION_VECTOR && accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE && trackingActive) {
            reportStatus("A bússola está com baixa confiabilidade neste ambiente; o traçado pode desviar. Corrija a direção quando possível.")
        }
    }

    private fun reportStep() = runOnUiThread {
        if (trackingActive && stepsWanted && ::webView.isInitialized) {
            webView.evaluateJavascript("window.onNativeStepDetected && window.onNativeStepDetected();", null)
        }
    }

    private fun reportHeading(degrees: Double) = runOnUiThread {
        if (trackingActive && ::webView.isInitialized) {
            val value = String.format(Locale.US, "%.2f", degrees)
            webView.evaluateJavascript("window.onNativeHeading && window.onNativeHeading($value);", null)
        }
    }

    private fun reportStatus(message: String) = runOnUiThread {
        if (::webView.isInitialized) {
            val quoted = JSONObject.quote(message)
            webView.evaluateJavascript("window.onNativeSensorStatus && window.onNativeSensorStatus($quoted);", null)
        }
    }

    private fun launchSaveJsonFile(filename: String, content: String) = runOnUiThread {
        pendingJson = content
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, filename)
        }
        startActivityForResult(intent, REQUEST_SAVE_JSON)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_FILE) {
            val callback = fileChooserCallback
            fileChooserCallback = null
            callback?.onReceiveValue(if (resultCode == RESULT_OK && data?.data != null) arrayOf(data.data!!) else null)
        } else if (requestCode == REQUEST_SAVE_JSON) {
            val content = pendingJson
            pendingJson = null
            val uri = data?.data
            if (resultCode == RESULT_OK && uri != null && content != null) {
                try {
                    contentResolver.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) }
                    reportStatus("Cópia JSON salva.")
                } catch (_: Exception) {
                    reportStatus("Não consegui salvar a cópia JSON. Tente novamente.")
                }
            }
        }
    }

    inner class NativeSensorsBridge {
        @JavascriptInterface fun startTracking(useStepSensor: Boolean) = runOnUiThread { startTrackingOnUi(useStepSensor) }
        @JavascriptInterface fun stopTracking() = runOnUiThread { stopTrackingOnUi() }
        @JavascriptInterface fun saveJsonFile(filename: String, content: String) = launchSaveJsonFile(filename, content)
    }

    companion object {
        private const val CRASH_PREFS = "startup_diagnostics"
        private const val CRASH_KEY = "last_uncaught_exception"
        private const val REQUEST_RECOGNITION = 701
        private const val REQUEST_FILE = 702
        private const val REQUEST_SAVE_JSON = 703
    }
}
