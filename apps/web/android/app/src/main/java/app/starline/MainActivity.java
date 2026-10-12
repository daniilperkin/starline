package app.starline;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugin: Capacitor auto-discovers plugins from library modules, but one that
        // lives in the app module itself has to be registered explicitly, before super.onCreate.
        registerPlugin(StarlineGoogleAuthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
