package fr.kumm.app;

import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

// Remplace celle générée par Capacitor : enregistre les modules natifs de Kumm (mise à jour : KummUpdater.java ;
// widgets de l'écran d'accueil : KummWidgets.java ; trajet suivi : KummTrip.java)
public class MainActivity extends BridgeActivity {
    private static final long SPLASH_MAX_MS = 3000;   // page qui ne se dessine pas : l'écran de démarrage ne reste pas affiché
    private volatile boolean webReady = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // écran de démarrage Android gardé jusqu'à ce que la page (et son animation de lancement, même fond vert) soit
        // dessinée : sans ça, la fenêtre vide (noire en thème sombre) apparaît entre le logo et l'animation
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        long start = SystemClock.uptimeMillis();
        splash.setKeepOnScreenCondition(() -> !webReady && SystemClock.uptimeMillis() - start < SPLASH_MAX_MS);
        registerPlugin(KummUpdater.class);
        registerPlugin(KummWidgets.class);
        registerPlugin(KummGtfs.class);
        registerPlugin(KummTrip.class);
        super.onCreate(savedInstanceState);
        getWindow().setBackgroundDrawable(new ColorDrawable(0xFF136342));
        if (bridge == null) { webReady = true; return; }
        // taille du texte choisie dans les réglages d'Android (accessibilité) : la WebView ne la suit pas d'elle-même ;
        // plafonnée à 140 % pour que les tuiles et les tableaux de départs restent lisibles
        float fontScale = getResources().getConfiguration().fontScale;
        bridge.getWebView().getSettings().setUserAgentString(bridge.getWebView().getSettings().getUserAgentString() + " Kumm/0.53.0 (fr.kumm.app; https://github.com/Qoats/Kumm)");
        bridge.getWebView().getSettings().setTextZoom(Math.max(100, Math.min(140, Math.round(fontScale * 100))));
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                view.postVisualStateCallback(1, new WebView.VisualStateCallback() {
                    @Override
                    public void onComplete(long requestId) { webReady = true; }
                });
            }

            @Override
            public void onPageLoaded(WebView webView) { webReady = true; }

            @Override
            public void onReceivedError(WebView webView) { webReady = true; }
        });
    }
}
