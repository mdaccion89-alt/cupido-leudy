package com.cupido.leudy;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "AndroidMediaPermissions",
    permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class AndroidMediaPermissionsPlugin extends Plugin {
    @PluginMethod
    public void request(PluginCall call) {
        boolean requestCamera = call.getBoolean("camera", true);
        boolean requestMicrophone = call.getBoolean("microphone", true);
        if (requestCamera && requestMicrophone) {
            requestPermissionForAliases(new String[] { "camera", "microphone" }, call, "permissionResult");
        } else if (requestCamera) {
            requestPermissionForAliases(new String[] { "camera" }, call, "permissionResult");
        } else if (requestMicrophone) {
            requestPermissionForAliases(new String[] { "microphone" }, call, "permissionResult");
        } else {
            permissionResult(call);
        }
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("camera", getPermissionState("camera") == PermissionState.GRANTED);
        result.put("microphone", getPermissionState("microphone") == PermissionState.GRANTED);
        call.resolve(result);
    }
}
