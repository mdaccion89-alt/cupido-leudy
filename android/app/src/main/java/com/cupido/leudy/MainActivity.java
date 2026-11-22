package com.cupido.leudy;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidMediaPermissionsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
