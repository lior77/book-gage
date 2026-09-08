package app.porto.atlas;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.app.Activity;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * The whole app is the web app.  This activity exists to do three things the
 * browser could not do with a downloaded file:
 *
 *  1. Serve the bundled files from a real https origin.  A file:// page and the
 *     content:// URI Android hands a downloaded file both have no origin at
 *     all, and a browser will not give either of them a position — there is no
 *     site to grant the permission to.  Intercepting requests for a private
 *     host solves that without shipping a server: the page runs on
 *     https://porto.local/, which is an origin, and geolocation and storage
 *     behave as they do on any website.
 *  2. Ask Android for the location permission and pass the answer through to
 *     the page.
 *  3. Open a file picker.  A WebView ignores <input type="file"> entirely
 *     unless onShowFileChooser is implemented — the control renders and does
 *     nothing when tapped, with no error anywhere.  That is why attaching a
 *     photo worked in a browser and not in the app.
 *  4. Make the system back button walk up the app's own levels instead of
 *     closing it.
 */
public class MainActivity extends Activity {

    private static final String HOST = "porto.local";
    private static final String ORIGIN = "https://" + HOST + "/";
    private static final String START = ORIGIN + "index.html";
    private static final int REQ_LOCATION = 1;
    private static final int REQ_FIRST_RUN = 2;
    private static final int REQ_FILE = 3;
    private static final String PREFS = "porto";
    private static final String ASKED = "asked-permissions";

    private WebView web;
    /** Set while the page is waiting to hear whether it may have a position. */
    private String pendingOrigin;
    private GeolocationPermissions.Callback pendingCallback;
    /** Set while the system file picker is open on the page's behalf. */
    private ValueCallback<Uri[]> pendingFiles;

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("css", "text/css");
        MIME.put("js", "text/javascript");
        MIME.put("json", "application/json");
        MIME.put("geojson", "application/geo+json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("png", "image/png");
        MIME.put("svg", "image/svg+xml");
        MIME.put("pdf", "application/pdf");
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage: the user's own points
        s.setGeolocationEnabled(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        // OSM tiles when there is a connection; the vector map when there is not
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;   // tiles and the rest go to the network
                return fromAssets(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // a link out — Google Maps, OpenStreetMap, a source — belongs in
                // the browser, not inside the app's own window
                try {
                    startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, u));
                } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            /**
             * Without this a file input is inert: the WebView shows the control
             * and swallows the tap.  createIntent() builds the picker Android
             * already knows how to show for the input's own `accept`, which for
             * a photo is the gallery, and on most phones the camera alongside
             * it.  Going through the system picker is also why the app needs no
             * storage permission: the user chooses one file and hands over that
             * file, rather than the app being given the whole library.
             */
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = cb;
                try {
                    Intent pick = params.createIntent();
                    pick.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(
                        Intent.createChooser(pick, getString(R.string.pick_photo)), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    // no app on the phone can answer the intent; tell the page
                    // nothing was chosen rather than leaving it waiting forever
                    pendingFiles = null;
                    cb.onReceiveValue(null);
                    return false;
                }
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                                                           GeolocationPermissions.Callback cb) {
                if (hasLocation()) {
                    cb.invoke(origin, true, true);
                    return;
                }
                pendingOrigin = origin;
                pendingCallback = cb;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                } else {
                    cb.invoke(origin, false, false);
                }
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(START);

        askOnce();
    }

    /**
     * Ask for the permission the app needs, once, on the first run.
     *
     * Only location is a permission here.  Reading a photo is not: the file
     * picker above returns a single file the user chose, which Android grants
     * without any storage permission at all — and asking for one the app does
     * not need would be worse than not asking, because it would be a request
     * for the whole photo library to do the job of one picture.
     *
     * Refusing is not fatal to anything: the map, the data and the points all
     * work without a position, and the button says so when it is denied.
     */
    private void askOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        android.content.SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (p.getBoolean(ASKED, false) || hasLocation()) return;
        p.edit().putBoolean(ASKED, true).apply();
        requestPermissions(new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_FIRST_RUN);
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILE) return;
        if (pendingFiles == null) return;
        // A cancelled picker still has to answer, or the input stays stuck and
        // the next tap on it does nothing.
        pendingFiles.onReceiveValue(result == RESULT_OK
            ? WebChromeClient.FileChooserParams.parseResult(result, data) : null);
        pendingFiles = null;
    }

    private boolean hasLocation() {
        return checkCallingOrSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] granted) {
        if (code == REQ_FIRST_RUN) return;      // nothing is waiting on the answer
        if (code != REQ_LOCATION || pendingCallback == null) return;
        boolean ok = false;
        for (int g : granted) if (g == PackageManager.PERMISSION_GRANTED) ok = true;
        pendingCallback.invoke(pendingOrigin, ok, true);
        pendingCallback = null;
        pendingOrigin = null;
    }

    /** An asset, served as if it came off a web server. */
    private WebResourceResponse fromAssets(String path) {
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        String rel = "site" + path;
        try {
            InputStream in = getAssets().open(rel.startsWith("/") ? rel.substring(1) : rel);
            Map<String, String> headers = new HashMap<>();
            // same origin as the page, so nothing here needs CORS; said out loud
            // because a WebResourceResponse with no headers is easy to misread
            headers.put("Cache-Control", "no-cache");
            WebResourceResponse r = new WebResourceResponse(mimeOf(path), "utf-8", in);
            r.setResponseHeaders(headers);
            return r;
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new HashMap<String, String>(), null);
        }
    }

    private static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String ext = path.substring(dot + 1).toLowerCase();
        String m = MIME.get(ext);
        return m != null ? m : "application/octet-stream";
    }

    @Override
    public void onBackPressed() {
        // The app is a single page with three levels of its own; the system back
        // button should climb them before it leaves.
        web.evaluateJavascript("(window.__portoBack && window.__portoBack()) ? '1' : '0'",
                value -> {
                    if (!"\"1\"".equals(value) && !"1".equals(value)) finish();
                });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }
}
