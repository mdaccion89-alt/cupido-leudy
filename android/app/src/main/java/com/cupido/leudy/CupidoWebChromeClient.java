package com.cupido.leudy;

import android.Manifest;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/** Keeps Capacitor's file picker and dialogs while explicitly granting WebRTC media access. */
public final class CupidoWebChromeClient extends BridgeWebChromeClient {
    private final Bridge bridge;

    public CupidoWebChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public void onPermissionRequest(final PermissionRequest request) {
        boolean requestsCamera = false;
        boolean requestsAudio = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) requestsCamera = true;
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) requestsAudio = true;
        }

        boolean cameraGranted = !requestsCamera || ContextCompat.checkSelfPermission(
            bridge.getContext(), Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED;
        boolean audioGranted = !requestsAudio || (
            ContextCompat.checkSelfPermission(bridge.getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(bridge.getContext(), Manifest.permission.MODIFY_AUDIO_SETTINGS)
                == PackageManager.PERMISSION_GRANTED
        );

        if (cameraGranted && audioGranted) {
            request.grant(request.getResources());
            return;
        }

        // Capacitor requests the missing Android runtime permissions, then grants WebView access.
        super.onPermissionRequest(request);
    }
}
