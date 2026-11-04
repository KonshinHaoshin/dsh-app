package moe.shelterhub.dsh;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;
import org.json.JSONArray;

@CapacitorPlugin(name = "DeviceCredentials")
public class DeviceCredentialsPlugin extends Plugin {
    private static final String ALIAS = "moe.shelterhub.dsh.device_credentials.v1";

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("dsh-device-credentials", Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void getRegistry(PluginCall call) {
        String value = getContext().getSharedPreferences("dsh-device-registry", Context.MODE_PRIVATE).getString("value", null);
        JSObject result = new JSObject();
        result.put("value", value == null ? JSONObject.NULL : value);
        call.resolve(result);
    }

    @PluginMethod
    public void setRegistry(PluginCall call) {
        try {
            String value = call.getString("value");
            if (value == null || value.length() > 262144) throw new IllegalArgumentException();
            JSONArray entries = new JSONArray(value);
            for (int i = 0; i < entries.length(); i++) {
                if (entries.getJSONObject(i).has("token")) throw new IllegalArgumentException();
            }
            if (!getContext().getSharedPreferences("dsh-device-registry", Context.MODE_PRIVATE).edit().putString("value", value).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception ignored) {
            call.reject("无法保存电脑列表，请稍后重试");
        }
    }

    private String entryKey(PluginCall call) {
        String key = call.getString("key");
        if (key == null || !key.matches("[a-zA-Z0-9_-]{1,100}")) throw new IllegalArgumentException();
        return key;
    }

    private static synchronized SecretKey encryptionKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    static String readCredential(Context context, String key) throws Exception {
        String encoded = context.getSharedPreferences("dsh-device-credentials", Context.MODE_PRIVATE).getString(key, null);
        if (encoded == null) return "";
        String[] parts = encoded.split("\\.", 2);
        if (parts.length != 2) throw new IllegalArgumentException();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    @PluginMethod
    public void get(PluginCall call) {
        try {
            String key = entryKey(call), encoded = preferences().getString(key, null);
            JSObject result = new JSObject();
            if (encoded == null) {
                result.put("value", JSONObject.NULL);
            } else {
                String[] parts = encoded.split("\\.", 2);
                if (parts.length != 2) throw new IllegalArgumentException();
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
                result.put("value", new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception ignored) {
            call.reject("无法读取此电脑的配对信息，请重新扫码配对");
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        try {
            String key = entryKey(call), value = call.getString("value");
            if (value == null || value.length() < 24 || value.length() > 4096) throw new IllegalArgumentException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "."
                + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!preferences().edit().putString(key, encoded).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception ignored) {
            call.reject("无法安全保存配对信息，请稍后重试");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            if (!preferences().edit().remove(entryKey(call)).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception ignored) {
            call.reject("无法移除此电脑的配对信息，请重试");
        }
    }
}
