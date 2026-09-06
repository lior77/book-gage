package app.porto.atlas;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
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
 *  3. Make the system back button walk up the app's own levels instead of
 *     closing it.
 */
public class MainActivity extends Activity {

    private static final String HOST = "porto.local";
    private static final String ORIGIN = "https://" + HOST + "/";
    private static final String START = ORIGIN + "index.html";
    private static final int REQ_LOCATION = 1;

    private WebView web;
    /** Set while the page is waiting to hear whether it may have a position. */
    private String pendingOrigin;
    private GeolocationPermissions.Callback pendingCallback;

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
    }

    private boolean hasLocation() {
        return checkCallingOrSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] granted) {
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
