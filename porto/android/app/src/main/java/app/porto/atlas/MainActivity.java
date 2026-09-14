package app.porto.atlas;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.app.Activity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
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
 *  5. Write an exported file somewhere the reader can find it.  There is no
 *     download manager behind a bare WebView: an <a download> click is
 *     swallowed with no error and no file, which is indistinguishable from a
 *     dead button.  Saver below is the one thing the page can call into.
 */
public class MainActivity extends Activity {

    private static final String HOST = "porto.local";
    private static final String ORIGIN = "https://" + HOST + "/";
    private static final String START = ORIGIN + "index.html";
    private static final int REQ_LOCATION = 1;
    private static final int REQ_FIRST_RUN = 2;
    private static final int REQ_FILE = 3;
    private static final int REQ_PICK = 4;
    private static final String PREFS = "porto";
    private static final String ASKED = "asked-permissions";
    /** A pick that has been started and not yet answered. Survives the process. */
    private static final String PICK_KIND = "pick-kind";
    /** The answer, waiting for the page to come and get it. Survives the process. */
    private static final String PICK_RESULT = "pick-result";
    /** What actually happened, in order, so that nothing is ever only silence. */
    private static final String PICK_TRAIL = "pick-trail";
    /** Served from the cache directory, so the page reads bytes over http and
     *  no photo has to cross the JavaScript bridge as base64. */
    private static final String PICKED_PATH = "/__picked/";

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
                String path = u.getPath();
                if (path != null && path.startsWith(PICKED_PATH)) return fromPicked(path);
                return fromAssets(path);
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
                // Naming the chooser is a nicety; it must never be able to
                // take the picker down with it, because a picker that does not
                // open is a file input that does nothing when tapped and says
                // nothing about why.
                boolean image = true;
                try { image = wantsImage(params); } catch (Exception ignored) { }
                int title = image ? R.string.pick_photo : R.string.pick_file;
                try {
                    Intent pick = params.createIntent();
                    pick.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(Intent.createChooser(pick, getString(title)),
                                           REQ_FILE);
                    return true;
                } catch (Exception e) {
                    // createIntent() can hand back something no activity on this
                    // phone will answer. Ask for the plainest thing that could
                    // work before giving up on the input altogether.
                    try {
                        Intent plain = new Intent(Intent.ACTION_GET_CONTENT);
                        plain.addCategory(Intent.CATEGORY_OPENABLE);
                        plain.setType(image ? "image/*" : "*/*");
                        startActivityForResult(Intent.createChooser(plain, getString(title)),
                                               REQ_FILE);
                        return true;
                    } catch (Exception e2) {
                        // nothing on the phone can answer either; tell the page
                        // nothing was chosen rather than leaving it waiting
                        pendingFiles = null;
                        cb.onReceiveValue(null);
                        return false;
                    }
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

        // The page is the app's own asset on porto.local, and
        // shouldOverrideUrlLoading sends every other host to the browser, so
        // nothing but this app's own code ever reaches the bridge.
        web.addJavascriptInterface(new Saver(), "PortoSave");
        web.addJavascriptInterface(new Picker(), "PortoPick");

        if (state != null) {
            web.restoreState(state);
        } else {
            clearPickedCache();   // copies from the previous run; the page has its own by now
            web.loadUrl(START);
        }

        askOnce();
    }

    /** Which of the page's two file inputs opened the picker. */
    private static boolean wantsImage(WebChromeClient.FileChooserParams params) {
        String[] want = params.getAcceptTypes();
        if (want == null) return true;
        for (String w : want) if (w != null && w.startsWith("image/")) return true;
        return want.length == 0;
    }

    /**
     * Ask for the permissions the app needs, once, on the first run.
     *
     * Two, and neither is storage.  Reading a photo is not a permission: the
     * file picker above returns a single file the user chose, which Android
     * grants without one — and asking for the whole photo library to do the job
     * of one picture would be worse than not asking.
     *
     * ACCESS_MEDIA_LOCATION is not access to the library either.  It is the
     * difference between being handed the picked photo and being handed the
     * picked photo with its GPS tags still in it; without it Android zeroes
     * them on the way out, and a photo taken in Porto arrives looking like one
     * taken by a camera that never found a satellite.
     *
     * Refusing either is not fatal: the map, the data and the points all work
     * without a position, and a photo with no readable location leaves its
     * point where it was dropped and says so.
     */
    private void askOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        android.content.SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (p.getBoolean(ASKED, false) || (hasLocation() && hasMediaLocation())) return;
        p.edit().putBoolean(ASKED, true).apply();
        requestPermissions(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                               Manifest.permission.ACCESS_COARSE_LOCATION,
                               Manifest.permission.ACCESS_MEDIA_LOCATION}
                : new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                               Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_FIRST_RUN);
    }

    /* ---------------------------------------------------------------------
     * Picking a file, in a way that survives the activity being destroyed.
     *
     * WHAT WENT WRONG THREE TIMES.  The web way to pick a file is an <input
     * type="file">, which a WebView answers through onShowFileChooser by
     * handing back a ValueCallback.  That callback is an object in this
     * activity's memory.  While the system photo picker is in front, THIS
     * ACTIVITY CAN BE DESTROYED — by memory pressure, or by "don't keep
     * activities" — and this app is a fat one: the whole district's geometry
     * and up to 21.7 MB of REN/RAN outlines live in the WebView's heap, with
     * the picker's own process alongside it.  When that happens the callback
     * is gone, onCreate runs restoreState() and repaints the very screen the
     * reader was last looking at, and the result arrives at an activity that
     * has nothing left to give it to.  The reader sees the screen they started
     * from and not one word about why.
     *
     * Two earlier fixes aimed at the wrong layer: moving the input out of
     * re-rendered HTML (real, but not this), and singleTop instead of
     * singleTask (also real, and also not this).  Neither could help, because
     * nothing that lives in memory can.
     *
     * SO NOTHING HERE LIVES IN MEMORY.  The request is written to preferences
     * before the picker opens; the answer is written to preferences and the
     * bytes to the cache directory; the page comes and collects whatever is
     * waiting whenever it loads or comes back to the front.  A destroyed
     * activity costs nothing: the new one finds the same two records on disk.
     *
     * And every outcome is recorded, including the ones that used to return
     * without a word — a cancel, a result for a pick nobody is waiting for, a
     * result that never comes at all.  Silence was the actual bug for three
     * rounds; it is not a state this can reach any more.
     * ------------------------------------------------------------------- */

    private android.content.SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    /** A short, bounded record of what the picker did, readable from the page. */
    private void note(String line) {
        android.content.SharedPreferences p = prefs();
        String all = p.getString(PICK_TRAIL, "") + line + "\n";
        int cut = all.length() - 1200;
        if (cut > 0) {
            int nl = all.indexOf('\n', cut);
            all = nl >= 0 ? all.substring(nl + 1) : "";
        }
        p.edit().putString(PICK_TRAIL, all).apply();
    }

    /** The answer, on disk, and a nudge to the page in case it is already up. */
    private void finishPick(String payload) {
        prefs().edit().putString(PICK_RESULT, payload).remove(PICK_KIND).apply();
        note("ready " + (payload.length() > 90 ? payload.substring(0, 90) + "…" : payload));
        if (web != null) web.post(new Runnable() {
            @Override public void run() {
                web.evaluateJavascript("window.__portoPicked && window.__portoPicked()", null);
            }
        });
    }

    /** Every uri the picker handed back, whether one or many. */
    private static List<Uri> urisOf(Intent data) {
        List<Uri> out = new ArrayList<>();
        if (data == null) return out;
        android.content.ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri u = clip.getItemAt(i).getUri();
                if (u != null) out.add(u);
            }
        } else if (data.getData() != null) {
            out.add(data.getData());
        }
        return out;
    }

    /**
     * Copy what was picked into the app's own cache and describe it.
     *
     * The copy is not an optimisation: a content:// uri is granted to THIS
     * activity instance, and the whole point here is that the instance may not
     * be the one that reads it.  A file in the app's cache belongs to the app.
     */
    private String describe(String kind, List<Uri> uris) {
        File dir = new File(getCacheDir(), "picked");
        if (!dir.isDirectory() && !dir.mkdirs()) return "err:no-cache-dir";
        JSONArray files = new JSONArray();
        for (int i = 0; i < uris.size(); i++) {
            Uri u = uris.get(i);
            String type = null;
            try { type = getContentResolver().getType(u); } catch (Exception ignored) { }
            if (type == null) type = "photo".equals(kind) ? "image/jpeg" : "application/json";
            String name = "pick-" + System.nanoTime() + "-" + i
                        + ("photo".equals(kind) ? ".jpg" : ".json");
            File copy = new File(dir, name);
            try (InputStream in = open(u, "photo".equals(kind));
                 OutputStream to = new FileOutputStream(copy)) {
                if (in == null) throw new IOException("no stream");
                byte[] buf = new byte[64 * 1024];
                for (int n; (n = in.read(buf)) > 0; ) to.write(buf, 0, n);
            } catch (Exception e) {
                note("copy failed " + e);
                if (copy.exists() && !copy.delete()) { /* cache, not fatal */ }
                continue;
            }
            try {
                JSONObject f = new JSONObject();
                f.put("url", PICKED_PATH + name);
                f.put("name", nameOf(u, name));
                f.put("type", type);
                f.put("size", copy.length());
                files.put(f);
            } catch (Exception ignored) { }
        }
        if (files.length() == 0) return "err:nothing-copied";
        try {
            JSONObject out = new JSONObject();
            out.put("kind", kind);
            out.put("files", files);
            return out.toString();
        } catch (Exception e) {
            return "err:" + e;
        }
    }

    /**
     * The bytes as they are on disk where that is allowed, so a photo keeps the
     * coordinates it was taken with; the plain stream otherwise.  Losing the
     * coordinates is a smaller failure than losing the photo.
     */
    private InputStream open(Uri u, boolean photo) throws IOException {
        if (photo && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && hasMediaLocation()) {
            try {
                return getContentResolver().openInputStream(MediaStore.setRequireOriginal(u));
            } catch (Exception e) {
                note("original refused, using the redacted copy");
            }
        }
        return getContentResolver().openInputStream(u);
    }

    private String nameOf(Uri u, String fallback) {
        try (android.database.Cursor c = getContentResolver()
                 .query(u, new String[]{android.provider.OpenableColumns.DISPLAY_NAME},
                        null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null && !n.isEmpty()) return n;
            }
        } catch (Exception ignored) { }
        return fallback;
    }

    /** A picked file, served to the page over the origin it already runs on. */
    private WebResourceResponse fromPicked(String path) {
        String name = path.substring(PICKED_PATH.length());
        if (name.isEmpty() || name.indexOf('/') >= 0 || name.contains(".."))
            return new WebResourceResponse("text/plain", "utf-8", 400, "Bad Request",
                    new HashMap<String, String>(), null);
        File f = new File(new File(getCacheDir(), "picked"), name);
        try {
            WebResourceResponse r = new WebResourceResponse(
                    name.endsWith(".json") ? "application/json" : "image/jpeg",
                    null, new java.io.FileInputStream(f));
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            r.setResponseHeaders(headers);
            return r;
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new HashMap<String, String>(), null);
        }
    }

    /** What the page calls instead of tapping a file input. */
    public class Picker {
        @JavascriptInterface
        public void open(final String kind) {
            final boolean photo = !"data".equals(kind);
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    prefs().edit().putString(PICK_KIND, photo ? "photo" : "data")
                                  .remove(PICK_RESULT).apply();
                    note("open " + (photo ? "photo" : "data"));
                    Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                    pick.addCategory(Intent.CATEGORY_OPENABLE);
                    // */* for the data file: a picker that filters on
                    // application/json hides .json files written by apps that
                    // label them text/plain, and then there is nothing to tap.
                    pick.setType(photo ? "image/*" : "*/*");
                    if (photo) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    try {
                        startActivityForResult(Intent.createChooser(pick,
                                getString(photo ? R.string.pick_photo : R.string.pick_file)),
                                REQ_PICK);
                    } catch (Exception e) {
                        note("no chooser " + e);
                        finishPick("err:no-chooser");
                    }
                }
            });
        }

        /** Whatever is waiting, once. Empty string when there is nothing. */
        @JavascriptInterface
        public String take() {
            android.content.SharedPreferences p = prefs();
            String r = p.getString(PICK_RESULT, "");
            if (!r.isEmpty()) {
                p.edit().remove(PICK_RESULT).apply();
                note("taken");
            }
            return r;
        }

        /** The record, for a reader who is being asked what the app did. */
        @JavascriptInterface
        public String trail() {
            return prefs().getString(PICK_TRAIL, "");
        }
    }

    /**
     * Everything between a photo being chosen and the page's input receiving it
     * happens out here, where the page cannot see it.  When it goes wrong the
     * page is left exactly as it was — which reads as an app that ignored the
     * tap — so the outcome is reported back and the page says what happened
     * instead of saying nothing.
     */
    private void tellPage(String what) {
        final String js = "window.__portoPicker && window.__portoPicker("
                          + JSONObject.quote(what) + ")";
        web.post(new Runnable() {
            @Override public void run() { web.evaluateJavascript(js, null); }
        });
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == REQ_PICK) {
            List<Uri> uris = result == RESULT_OK ? urisOf(data) : new ArrayList<Uri>();
            note("result " + result + " uris " + uris.size());
            if (result != RESULT_OK) finishPick("cancelled:" + result);
            else if (uris.isEmpty()) finishPick("empty:" + (data == null ? "no-intent" : "no-uris"));
            else finishPick(describe(prefs().getString(PICK_KIND, "photo"), uris));
            return;
        }
        if (code != REQ_FILE) return;
        // The legacy path: a file input somewhere that does not go through the
        // bridge. It answers where it can and says so where it cannot; it is no
        // longer the way a photo or a saved file arrives.
        if (pendingFiles == null) {
            note("a chooser answered with nothing left to answer to");
            return;
        }
        // A cancelled picker still has to answer, or the input stays stuck and
        // the next tap on it does nothing.
        Uri[] picked = result == RESULT_OK
            ? WebChromeClient.FileChooserParams.parseResult(result, data) : null;
        if (result != RESULT_OK) {
            tellPage("cancelled:" + result);
        } else if (picked == null || picked.length == 0) {
            tellPage("empty:" + (data == null ? "no-intent" : "no-uris"));
        }
        Uri[] out = picked == null ? null : unredacted(picked);
        if (out != null && out.length > 0) {
            tellPage("ok:" + out.length + ":"
                     + (out[0] == null ? "null" : String.valueOf(out[0].getScheme())));
        }
        pendingFiles.onReceiveValue(out);
        pendingFiles = null;
    }

    /**
     * Hand the page the photo with its own GPS tags, not the copy Android
     * blanks on the way out.
     *
     * Holding ACCESS_MEDIA_LOCATION is necessary but, depending on which
     * provider answered the picker, not always sufficient: the documented way
     * to ask for the bytes as they are on disk is setRequireOriginal(), and it
     * only applies to MediaStore uris.  So this tries it, copies the result
     * into the app's own cache, and hands that file over instead.
     *
     * Every failure here falls back to the uri exactly as the picker returned
     * it.  A photo that loses its coordinates is the bug being fixed; a photo
     * that does not arrive at all would be a worse one.
     */
    private Uri[] unredacted(Uri[] picked) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !hasMediaLocation()) return picked;
        Uri[] out = new Uri[picked.length];
        for (int i = 0; i < picked.length; i++) {
            out[i] = picked[i];
            if (picked[i] == null) continue;
            File copy = null;
            try {
                Uri original = MediaStore.setRequireOriginal(picked[i]);
                File dir = new File(getCacheDir(), "picked");
                if (!dir.isDirectory() && !dir.mkdirs()) continue;
                copy = new File(dir, "photo-" + System.nanoTime() + ".jpg");
                try (InputStream in = getContentResolver().openInputStream(original);
                     OutputStream to = new FileOutputStream(copy)) {
                    if (in == null) throw new IOException("no stream");
                    byte[] buf = new byte[64 * 1024];
                    for (int n; (n = in.read(buf)) > 0; ) to.write(buf, 0, n);
                }
                if (copy.length() > 0) out[i] = Uri.fromFile(copy);
                else if (copy.exists() && !copy.delete()) copy = null;
            } catch (Exception e) {
                // setRequireOriginal rejects a non-MediaStore uri, and the read
                // can fail for reasons of its own.  Either way the original uri
                // still works; it just may not carry the coordinates.
                if (copy != null && copy.exists() && !copy.delete()) { /* cache, not fatal */ }
            }
        }
        return out;
    }

    /** Cached copies of picked photos, cleared so they do not accumulate. */
    private void clearPickedCache() {
        // Except when one of them IS the answer the page has not collected yet.
        // A fresh launch after the app was killed mid-pick is exactly when that
        // file matters most, and deleting it would hand the page a url that
        // 404s — the same silence, one layer down.
        if (!prefs().getString(PICK_RESULT, "").isEmpty()) return;
        File dir = new File(getCacheDir(), "picked");
        File[] old = dir.listFiles();
        if (old == null) return;
        for (File f : old) if (!f.delete()) { /* next run will try again */ }
    }

    private boolean hasMediaLocation() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return checkCallingOrSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
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

    /**
     * The export, written to disk.
     *
     * From Android 10 the file goes into the phone's real Downloads folder
     * through MediaStore, which needs no permission and puts it where a file
     * manager, a mail app and a cable all find it.  Before that, MediaStore
     * has no Downloads collection and writing to the public folder would mean
     * asking for WRITE_EXTERNAL_STORAGE — a permission over the whole card, to
     * save one file the user asked for.  So on those versions it goes into the
     * app's own external directory, which needs nothing, and the answer says
     * the full path because a file the reader cannot find is not saved.
     *
     * The answer is a string rather than a boolean for the same reason the
     * layer download reports which failure it was: "it did not work" sends
     * nobody anywhere.
     */
    public class Saver {
        @JavascriptInterface
        public String save(String name, String b64) {
            if (name == null || name.isEmpty() || name.indexOf('/') >= 0) return "err:bad name";
            byte[] data;
            try {
                data = Base64.decode(b64, Base64.DEFAULT);
            } catch (Exception e) {
                return "err:" + e;
            }
            try {
                // MediaStore.Downloads does not exist before API 29, and a
                // reference to it inside this method would be resolved when the
                // method runs — on an older phone that is NoClassDefFoundError,
                // not a skipped branch.  Hence the separate method.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                    return toDownloads(name, data);
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) return "err:no external storage";
                if (!dir.isDirectory() && !dir.mkdirs()) return "err:" + dir;
                File f = new File(dir, name);
                try (OutputStream o = new FileOutputStream(f)) { o.write(data); }
                return "ok:" + f.getAbsolutePath();
            } catch (Exception e) {
                return "err:" + e;
            }
        }
    }

    /** Android 10 and up: the phone's real Downloads folder, no permission. */
    private String toDownloads(String name, byte[] data) throws IOException {
        ContentValues v = new ContentValues();
        v.put(MediaStore.Downloads.DISPLAY_NAME, name);
        v.put(MediaStore.Downloads.MIME_TYPE, "application/json");
        v.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri item = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (item == null) return "err:Downloads refused the file";
        try (OutputStream o = getContentResolver().openOutputStream(item)) {
            if (o == null) throw new IOException("no stream");
            o.write(data);
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.Downloads.IS_PENDING, 0);
        getContentResolver().update(item, done, null, null);
        return "ok:Download/" + name;
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

    /**
     * A pick that is still marked in flight once the app is back in front and
     * settled has lost its answer — the picker was killed, or the result went
     * to an activity instance that no longer exists.  That is a thing to say,
     * not a thing to wait for forever.
     */
    @Override
    protected void onResume() {
        super.onResume();
        if (prefs().getString(PICK_KIND, "").isEmpty()) return;
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override public void run() {
                String kind = prefs().getString(PICK_KIND, "");
                if (kind.isEmpty()) return;              // answered in the meantime
                if (!prefs().getString(PICK_RESULT, "").isEmpty()) return;
                note("lost " + kind);
                finishPick("lost:" + kind);
            }
        }, 1500);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }
}
