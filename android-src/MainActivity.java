package fr.kumm.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Remplace celle générée par Capacitor : enregistre les modules natifs de Kumm (mise à jour : KummUpdater.java ;
// widgets de l'écran d'accueil : KummWidgets.java)
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KummUpdater.class);
        registerPlugin(KummWidgets.class);
        super.onCreate(savedInstanceState);
    }
}
