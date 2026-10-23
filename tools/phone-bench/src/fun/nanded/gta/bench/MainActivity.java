package fun.nanded.gta.bench;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * GTA Nanded in a WebView, served from the APK's assets, with a scripted benchmark
 * (assets/bench.js) that plays the game and logs what it measures. Launched by Firebase
 * Test Lab's game loop intent, it writes the results to the file Test Lab gives it and exits.
 */
public class MainActivity extends Activity {
  static final String HOST = "appassets.androidplatform.net";
  static final String TAG = "GTABENCH";
  WebView web;
  Uri resultUri;
  boolean injected = false, finished = false;
  final StringBuilder results = new StringBuilder();

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    Intent intent = getIntent();
    if ("com.google.intent.action.TEST_LOOP".equals(intent.getAction())) resultUri = intent.getData();
    WebView.setWebContentsDebuggingEnabled(true);
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onConsoleMessage(ConsoleMessage m) {
        String msg = m.message();
        Log.i(TAG, msg);
        if (msg.startsWith("BENCH ")) results.append(msg.substring(6)).append('\n');
        return true;
      }
    });
    web.setWebViewClient(new WebViewClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!HOST.equals(url.getHost())) return null;
        String path = url.getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        try {
          InputStream in = getAssets().open("www" + path);
          return new WebResourceResponse(mime(path), null, in);
        } catch (IOException e) {
          return new WebResourceResponse("text/plain", null, 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
        }
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        if (injected) return;
        injected = true;
        view.evaluateJavascript(asset("bench.js"), null);
      }
    });
    web.addJavascriptInterface(new Object() {
      @JavascriptInterface
      public void done() { runOnUiThread(() -> finishLoop()); }
    }, "Bench");
    setContentView(web);
    web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    web.loadUrl("https://" + HOST + "/index.html?perf");
  }

  @Override
  protected void onDestroy() {
    // A WebView left behind keeps running its page: never two games at once.
    if (web != null) { web.stopLoading(); web.destroy(); web = null; }
    super.onDestroy();
  }

  void finishLoop() {
    if (finished) return;
    finished = true;
    if (resultUri != null) {
      try (OutputStream out = getContentResolver().openOutputStream(resultUri)) {
        out.write(results.toString().getBytes("UTF-8"));
      } catch (Exception e) {
        Log.e(TAG, "could not write results", e);
      }
    }
    Log.i(TAG, "done");
    finish();
  }

  String asset(String name) {
    try (InputStream in = getAssets().open(name)) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      for (int n; (n = in.read(buf)) > 0;) out.write(buf, 0, n);
      return out.toString("UTF-8");
    } catch (IOException e) {
      return "console.log('BENCH {\"error\":\"no bench.js\"}')";
    }
  }

  static String mime(String path) {
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".js")) return "text/javascript";
    if (path.endsWith(".css")) return "text/css";
    if (path.endsWith(".json")) return "application/json";
    if (path.endsWith(".webmanifest")) return "application/manifest+json";
    if (path.endsWith(".webp")) return "image/webp";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".m4a")) return "audio/mp4";
    return "application/octet-stream";
  }
}
