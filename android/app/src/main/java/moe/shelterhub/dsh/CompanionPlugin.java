package moe.shelterhub.dsh;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.lang.ref.WeakReference;
import org.json.*;

@CapacitorPlugin(name="Companion",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class CompanionPlugin extends Plugin {
    private static WeakReference<CompanionPlugin> current=new WeakReference<>(null);
    private static JSONObject navigation;
    @Override public void load(){current=new WeakReference<>(this);}
    @Override protected void handleOnDestroy(){if(current.get()==this)current.clear();super.handleOnDestroy();}
    static void changed(String snapshot){CompanionPlugin p=current.get();if(p!=null)p.emit("state",p.state());}
    private void emit(String event,JSObject value){new Handler(Looper.getMainLooper()).post(()->notifyListeners(event,value));}
    private JSObject state(){
        CompanionService service=CompanionService.instance;JSObject state;
        try{state=new JSObject(service==null?"{\"hosts\":[],\"approvals\":[]}":service.snapshot);}catch(Exception e){state=new JSObject();}
        state.put("foreground",MainActivity.visible);state.put("enabled",CompanionService.enabled(getContext()));state.put("running",service!=null);
        state.put("notifications",NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        state.put("batteryUnrestricted",((PowerManager)getContext().getSystemService(Context.POWER_SERVICE)).isIgnoringBatteryOptimizations(getContext().getPackageName()));
        return state;
    }
    @PluginMethod public void getState(PluginCall call){call.resolve(state());}
    @PluginMethod public void enable(PluginCall call){
        if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"notificationPermission");return;}
        start(call);
    }
    @PermissionCallback private void notificationPermission(PluginCall call){if(getPermissionState("notifications")==PermissionState.GRANTED)start(call);else call.reject("需要允许通知，才能接收任务和审批提醒；可在系统通知设置中开启");}
    private void start(PluginCall call){
        try{getContext().getSharedPreferences(CompanionService.PREFS,Context.MODE_PRIVATE).edit().putBoolean(CompanionService.ENABLED,true).commit();getContext().startForegroundService(new Intent(getContext(),CompanionService.class));call.resolve(state());}
        catch(Exception e){getContext().getSharedPreferences(CompanionService.PREFS,Context.MODE_PRIVATE).edit().putBoolean(CompanionService.ENABLED,false).commit();call.reject("无法启动后台连接，请回到 App 后重试");}
    }
    @PluginMethod public void disable(PluginCall call){getContext().getSharedPreferences(CompanionService.PREFS,Context.MODE_PRIVATE).edit().putBoolean(CompanionService.ENABLED,false).commit();getContext().stopService(new Intent(getContext(),CompanionService.class));call.resolve(state());}
    @PluginMethod public void sync(PluginCall call){
        CompanionService service=CompanionService.instance;
        if(service!=null)service.worker.post(service::refresh);
        else if(CompanionService.enabled(getContext())&&MainActivity.visible){try{getContext().startForegroundService(new Intent(getContext(),CompanionService.class));}catch(Exception ignored){}}
        call.resolve(state());
    }
    @PluginMethod public void answer(PluginCall call){
        String key=call.getString("key"),eventId=call.getString("eventId");Boolean allow=call.getBoolean("allow");CompanionService service=CompanionService.instance;
        if(service==null||key==null||eventId==null||allow==null){call.reject("后台审批连接不可用，请重试");return;}service.answer(key,eventId,allow,call);
    }
    @PluginMethod public void batterySettings(PluginCall call){
        try{getActivity().startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+getContext().getPackageName())));call.resolve();}catch(Exception e){call.reject("请在系统设置中将 DSH 的电池使用设为不受限制");}
    }
    @PluginMethod public void notificationSettings(PluginCall call){getActivity().startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getContext().getPackageName()));call.resolve();}
    static synchronized void navigation(Intent intent){
        String key=intent.getStringExtra("deviceKey");if(key==null)return;
        navigation=CompanionService.json("key",key,"sessionId",intent.getStringExtra("sessionId"),"kind",intent.getStringExtra("noticeKind"));
        CompanionPlugin p=current.get();if(p!=null)p.emit("navigation",new JSObject());
    }
    @PluginMethod public synchronized void takeNavigation(PluginCall call){
        synchronized(CompanionPlugin.class){
            if(navigation==null)navigation(getActivity().getIntent());
            JSObject result=new JSObject();result.put("navigation",navigation==null?JSONObject.NULL:navigation);navigation=null;
            getActivity().getIntent().removeExtra("deviceKey");getActivity().getIntent().removeExtra("sessionId");getActivity().getIntent().removeExtra("noticeKind");call.resolve(result);
        }
    }
}
