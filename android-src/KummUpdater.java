package fr.kumm.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Mise à jour de Kumm depuis l'application : télécharge le nouvel APK (dans le cache de l'application), vérifie son empreinte
 * SHA-256 et son nom de paquet, puis ouvre l'installateur d'Android (« Mettre à jour cette application ? »).
 * Android refuse de lui-même un APK qui ne serait pas signé avec la même clé que l'application installée.
 */
@CapacitorPlugin(name = "KummUpdater")
public class KummUpdater extends Plugin {
    private volatile boolean busy = false;

    private boolean allowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    /** L'utilisateur a-t-il autorisé Kumm à installer des applications (réglage « Sources inconnues ») ? */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", allowed());
        call.resolve(r);
    }

    /** Ouvre le réglage Android « Installer des applications inconnues » de Kumm */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Réglage introuvable : " + e.getMessage());
        }
    }

    /** Télécharge puis installe ; événements « progress » { done, total } pendant le téléchargement */
    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        String sha = call.getString("sha256", "").toLowerCase();
        if (!url.startsWith("https://") || !sha.matches("[0-9a-f]{64}")) { call.reject("Mise à jour invalide"); return; }
        if (!allowed()) { call.reject("Autorisation d'installer manquante", "PERMISSION"); return; }
        if (busy) { call.reject("Téléchargement déjà en cours"); return; }
        busy = true;
        new Thread(() -> {
            try {
                File apk = download(url, sha);
                launch(apk);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Échec du téléchargement");
            } finally {
                busy = false;
            }
        }).start();
    }

    private File download(String url, String sha) throws Exception {
        Context ctx = getContext();
        File dir = new File(ctx.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("Espace de stockage indisponible");
        // un fichier par version : un nouvel appui pendant que l'installateur d'Android lit le fichier ne l'efface plus
        // (sinon Android répond « Application non installée ») ; une version déjà téléchargée et vérifiée est réutilisée
        File out = new File(dir, "kumm-" + sha.substring(0, 16) + ".apk");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) if (!f.getName().equals(out.getName())) f.delete();
        if (out.isFile() && sha.equals(sha256(out))) { progress(out.length(), out.length()); return checked(ctx, out); }
        File part = new File(dir, out.getName() + ".part");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("Le serveur a répondu " + c.getResponseCode());
            long total = c.getContentLengthLong(), done = 0, lastSent = 0;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    md.update(buf, 0, n);
                    done += n;
                    long now = System.currentTimeMillis();
                    if (now - lastSent > 250) { lastSent = now; progress(done, total); }
                }
            }
            progress(done, total);
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest()) hex.append(String.format("%02x", b));
            if (!hex.toString().equals(sha)) { part.delete(); throw new Exception("Fichier abîmé pendant le téléchargement : réessayez"); }
        } finally {
            c.disconnect();
        }
        // le fichier n'est rendu visible à l'installateur qu'une fois complet et vérifié
        if (!part.renameTo(out)) { part.delete(); throw new Exception("Espace de stockage indisponible"); }
        return checked(ctx, out);
    }

    private File checked(Context ctx, File apk) throws Exception {
        PackageInfo info = ctx.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (info == null || !ctx.getPackageName().equals(info.packageName)) { apk.delete(); throw new Exception("Ce fichier n'est pas une version de Kumm"); }
        return apk;
    }

    private static String sha256(File f) {
        try (InputStream in = new java.io.FileInputStream(f)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest()) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private void progress(long done, long total) {
        JSObject p = new JSObject();
        p.put("done", done);
        p.put("total", total);
        notifyListeners("progress", p);
    }

    private void launch(File apk) {
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }
}
