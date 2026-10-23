package fr.kumm.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Remplace celle générée par Capacitor : enregistre le module de mise à jour de Kumm (KummUpdater.java)
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KummUpdater.class);
        super.onCreate(savedInstanceState);
    }
}
