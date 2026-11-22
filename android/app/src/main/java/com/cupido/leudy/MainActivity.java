package com.cupido.leudy;

import android.Manifest;
import android.content.pm.PackageManager;
import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.os.Build;
import androidx.core.content.ContextCompat;

public class MainActivity extends BridgeActivity {
    private static final int MEDIA_PERMISSION_REQUEST = 8704;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidMediaPermissionsPlugin.class);
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setWebChromeClient(new CupidoWebChromeClient(getBridge()));
        }

        requestMediaPermissionsAtLaunch();
    }

    private void requestMediaPermissionsAtLaunch() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;

        boolean cameraMissing = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED;
        boolean microphoneMissing = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED;
        if (cameraMissing || microphoneMissing) {
            requestPermissions(new String[] {
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO
            }, MEDIA_PERMISSION_REQUEST);
        }
    }
}
