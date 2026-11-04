package moe.shelterhub.dsh;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeviceCredentialsPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.WHITE);
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    @Override
    public void onBackPressed() {
        if (bridge == null) { super.onBackPressed(); return; }
        bridge.getWebView().evaluateJavascript(
            "(function(){if(document.querySelector('.modal-layer,.drawer-scrim')){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return true;}return false;})()",
            result -> { if (!"true".equals(result)) moveTaskToBack(true); }
        );
    }
}
