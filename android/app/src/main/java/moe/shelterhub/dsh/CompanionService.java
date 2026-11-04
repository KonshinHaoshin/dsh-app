package moe.shelterhub.dsh;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.net.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.*;
import java.net.URI;
import java.util.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;

/** Native message continuity; no WebView timers or JavaScript are needed while locked. */
public class CompanionService extends Service {
    static volatile CompanionService instance;
    static final String PREFS="dsh-background", ENABLED="enabled";
    static final int ONGOING=4100;
    static final String CONNECTION="dsh-connection", TASKS="dsh-tasks", APPROVALS="dsh-approvals";
    private HandlerThread thread;
    Handler worker;
    private OkHttpClient http;
    private PowerManager.WakeLock wake;
    private ConnectivityManager network;
    private ConnectivityManager.NetworkCallback networkCallback;
    private final Map<String,Host> hosts=new LinkedHashMap<>();
    volatile String snapshot="{\"enabled\":true,\"hosts\":[],\"approvals\":[]}";
    private boolean stopped;
    volatile boolean foreground;
    private boolean wakeLoopStarted;
    private volatile int onlineCount,hostCount;
    static boolean enabled(Context ctx){return ctx.getSharedPreferences(PREFS,MODE_PRIVATE).getBoolean(ENABLED,false);}
    static void captureLastExit(Context context){
        if(Build.VERSION.SDK_INT<30)return;
        android.content.SharedPreferences prefs=context.getSharedPreferences(PREFS,MODE_PRIVATE);
        try{for(ApplicationExitInfo exit:((ActivityManager)context.getSystemService(ACTIVITY_SERVICE)).getHistoricalProcessExitReasons(null,0,5)){
            if(context.getPackageName().equals(exit.getProcessName())&&exit.getTimestamp()>prefs.getLong("lastStartedAt",0)&&exit.getTimestamp()>prefs.getLong("lastExitAt",0)){
                prefs.edit().putInt("lastExitReason",exit.getReason()).putLong("lastExitAt",exit.getTimestamp()).apply();break;
            }
        }}catch(Exception ignored){}
    }
    static void ensureRunning(Context context){
        android.content.SharedPreferences prefs=context.getSharedPreferences(PREFS,MODE_PRIVATE);
        // Existing notification permission lets a paired device start before the
        // WebView loads. Never override an explicit off choice or a denial.
        if(!prefs.contains(ENABLED)&&!prefs.getBoolean("setupAttempted",false)&&NotificationManagerCompat.from(context).areNotificationsEnabled())try{
            JSONArray records=new JSONArray(context.getSharedPreferences("dsh-device-registry",MODE_PRIVATE).getString("value","[]"));
            for(int i=0;i<records.length();i++){JSONObject record=records.getJSONObject(i);String key=record.optString("key");if(record.optBoolean("enabled",true)&&key.matches("[a-zA-Z0-9_-]{1,100}")&&context.getSharedPreferences("dsh-device-credentials",MODE_PRIVATE).contains(key)){prefs.edit().putBoolean(ENABLED,true).putBoolean("setupAttempted",true).commit();break;}}
        }catch(Exception ignored){}
        if(!enabled(context))return;
        CompanionService service=instance;
        if(service!=null&&service.foreground){if(service.worker!=null)service.worker.post(service::refresh);return;}
        try{context.startForegroundService(new Intent(context,CompanionService.class));}
        catch(Exception e){context.getSharedPreferences(PREFS,MODE_PRIVATE).edit().putString("lastError","系统暂未允许启动后台连接，请回到 App 并检查后台权限").apply();}
    }
    static JSONObject json(Object... values){JSONObject o=new JSONObject();try{for(int i=0;i<values.length;i+=2)o.put(String.valueOf(values[i]),values[i+1]);}catch(JSONException ignored){}return o;}
    static int noticeId(String key){return 5000+(key.hashCode()&0x3fffffff);}
    private NotificationManager notices(){return (NotificationManager)getSystemService(NOTIFICATION_SERVICE);}
    static void channels(Context ctx){
        NotificationManager nm=(NotificationManager)ctx.getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CONNECTION,"后台连接",NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel(TASKS,"任务结束",NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(new NotificationChannel(APPROVALS,"需要审批",NotificationManager.IMPORTANCE_HIGH));
    }
    static PendingIntent open(Context ctx,String key,String session,String kind){
        Intent intent=new Intent(ctx,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("deviceKey",key).putExtra("sessionId",session).putExtra("noticeKind",kind);
        intent.setData(Uri.parse("dsh://notice/"+Uri.encode(key)+"/"+Uri.encode(session)+"/"+kind));
        return PendingIntent.getActivity(ctx,noticeId(key+session+kind),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification ongoing(){
        int online=onlineCount;
        PendingIntent stop=PendingIntent.getService(this,0,new Intent(this,CompanionService.class).setAction("stop"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this,CONNECTION).setSmallIcon(R.drawable.ic_notification).setContentTitle("DSH 后台连接已开启")
            .setContentText(online+" / "+hostCount+" 台电脑在线 · 等待任务和审批消息").setOngoing(true).setOnlyAlertOnce(true)
            .setContentIntent(open(this,"","","connections")).addAction(0,"关闭后台连接",stop).build();
    }
    @Override public void onCreate(){
        super.onCreate();captureLastExit(this);instance=this;channels(this);
        thread=new HandlerThread("DSH companion");thread.start();worker=new Handler(thread.getLooper());
        http=new OkHttpClient.Builder().pingInterval(25,TimeUnit.SECONDS).connectTimeout(15,TimeUnit.SECONDS).build();
        network=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        networkCallback=new ConnectivityManager.NetworkCallback(){@Override public void onAvailable(Network n){worker.post(()->{for(Host h:hosts.values())if(!h.ready)h.open();});}};
        try{network.registerDefaultNetworkCallback(networkCallback);}catch(Exception ignored){}
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if((intent!=null&&"stop".equals(intent.getAction()))||!enabled(this)){
            getSharedPreferences(PREFS,MODE_PRIVATE).edit().putBoolean(ENABLED,false).commit();stopSelf();return START_NOT_STICKY;
        }
        if(Build.VERSION.SDK_INT>=34)startForeground(ONGOING,ongoing(),ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);else startForeground(ONGOING,ongoing());
        foreground=true;getSharedPreferences(PREFS,MODE_PRIVATE).edit().putLong("lastStartedAt",System.currentTimeMillis()).putString("lastError","").apply();
        worker.post(()->{refresh();if(wake==null){wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"DSH:remoteMessaging");wake.setReferenceCounted(false);}if(!wakeLoopStarted){wakeLoopStarted=true;renewWake();}});
        return START_STICKY;
    }
    private void renewWake(){if(stopped)return;if(wake.isHeld())wake.release();wake.acquire(10*60*1000L);worker.postDelayed(this::renewWake,5*60*1000L);}
    void refresh(){
        if(stopped)return;
        try{
            JSONArray records=new JSONArray(getSharedPreferences("dsh-device-registry",MODE_PRIVATE).getString("value","[]"));Set<String> desired=new HashSet<>();
            for(int i=0;i<records.length();i++){try{
                JSONObject record=records.getJSONObject(i);if(!record.optBoolean("enabled",true))continue;
                String key=record.getString("key");if(!key.matches("[a-zA-Z0-9_-]{1,100}"))continue;
                String token=DeviceCredentialsPlugin.readCredential(this,key);if(token.length()<24)continue;
                desired.add(key);Host previous=hosts.get(key);
                if(previous!=null&&previous.record.toString().equals(record.toString())&&previous.token.equals(token))continue;
                if(previous!=null)previous.dispose();Host host=new Host(key,record,token);hosts.put(key,host);host.open();
            }catch(Exception ignored){/* One unavailable key must not block other computers. */}}
            for(String key:new ArrayList<>(hosts.keySet()))if(!desired.contains(key)){hosts.remove(key).dispose();}
        }catch(Exception ignored){/* Never log credentials or let one broken registry stop the service. */}
        publish();
    }
    private void publish(){
        if(stopped)return;onlineCount=(int)hosts.values().stream().filter(h->h.ready).count();hostCount=hosts.size();
        JSONArray statuses=new JSONArray(),approvals=new JSONArray();
        for(Host h:hosts.values()){statuses.put(json("key",h.key,"online",h.ready,"eventsReady",!h.clientId.isEmpty(),"error",h.error,"transport",h.route));for(JSONObject approval:h.approvals.values())approvals.put(approval);}
        snapshot=json("enabled",!stopped,"hosts",statuses,"approvals",approvals).toString();
        CompanionPlugin.changed(snapshot);
        notices().notify(ONGOING,ongoing());
    }
    void answer(String key,String eventId,boolean allow,com.getcapacitor.PluginCall call){
        worker.post(()->{
            Host h=hosts.get(key);JSONObject pending=h==null?null:h.approvals.get(eventId);
            if(h==null||!h.ready||pending==null){call.reject("审批已结束或电脑暂时离线，请刷新后重试");return;}
            String id=UUID.randomUUID().toString();h.answers.put(id,call);h.answerEvents.put(id,eventId);
            h.send(json("type","call","id",id,"endpoint","$events/result","params",json("clientId",h.clientId,"eventId",eventId,"outcome",json("kind","result","value",allow?"allowed-once":"rejected"))));
            worker.postDelayed(()->{com.getcapacitor.PluginCall timeout=h.answers.remove(id);h.answerEvents.remove(id);if(timeout!=null)timeout.reject("审批回复超时，请检查会话状态后重试");},30000);
        });
    }
    private void notifyUser(Host host,String session,String kind,String eventId){
        boolean locked=((KeyguardManager)getSystemService(KEYGUARD_SERVICE)).isKeyguardLocked();
        if(MainActivity.visible&&!locked)return;
        String title=kind.equals("approval")?"DSH 需要你的审批":kind.equals("error")?"DSH 任务执行出现问题":"DSH 任务已结束";
        String text=host.name()+ (kind.equals("approval")?" 有操作等待确认，点击查看":" 有新的任务结果，点击查看");
        Notification publicView=new NotificationCompat.Builder(this,kind.equals("approval")?APPROVALS:TASKS).setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText("打开 DSH 查看详情").build();
        Notification n=new NotificationCompat.Builder(this,kind.equals("approval")?APPROVALS:TASKS).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title).setContentText(text).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(publicView)
            .setContentIntent(open(this,host.key,session,kind)).setAutoCancel(true).setOnlyAlertOnce(kind.equals("approval")).build();
        try{notices().notify(noticeId(host.key+(kind.equals("approval")?eventId:session)),n);}catch(SecurityException ignored){}
    }
    final class Host {
        final String key,token;final JSONObject record;HybridTransport socket;String route="relay";boolean ready,disposed;int attempt;String error="",clientId="",listId="";long lastFrame,listStarted,listRevision,eventRevision;Runnable retry,poll;
        final Map<String,Long> sessionRevisions=new HashMap<>();final Map<String,Boolean> running=new HashMap<>();final Set<String> failed=new HashSet<>();final Map<String,JSONObject> approvals=new LinkedHashMap<>();
        final Map<String,com.getcapacitor.PluginCall> answers=new HashMap<>();final Map<String,String> answerEvents=new HashMap<>();
        Host(String key,JSONObject record,String token){this.key=key;this.record=record;this.token=token;}
        String name(){return record.optString("alias",record.optString("name","我的 DSH"));}
        void send(JSONObject frame){if(socket!=null)socket.send(frame);}
        void open(){
            if(disposed||stopped)return;worker.removeCallbacksAndMessages(this);if(retry!=null)worker.removeCallbacks(retry);if(poll!=null)worker.removeCallbacks(poll);
            HybridTransport old=socket;socket=null;if(old!=null)old.close();ready=false;clientId="";listId="";clearApprovals();
            try{
                URI u=new URI(record.getString("url"));if(!Arrays.asList("http","https","ws","wss").contains(u.getScheme()))throw new IllegalArgumentException();boolean secure=u.getScheme().equals("https")||u.getScheme().equals("wss");
                if(!secure&&!record.optString("mode").equals("lan"))throw new IllegalArgumentException();
                if(u.getHost()==null||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null)throw new IllegalArgumentException();
                String url=new URI(secure?"wss":"ws",null,u.getHost(),u.getPort(),"/connect",null,null).toString();
                final HybridTransport[] generation=new HybridTransport[1];
                socket=generation[0]=new HybridTransport(CompanionService.this,worker,http,url,token,record.optString("deviceId"),!record.optString("mode").equals("lan"),new HybridTransport.Listener(){
                    public void frame(JSONObject value){if(socket!=generation[0])return;try{Host.this.frame(value);}catch(Exception e){lost(generation[0],"连接数据异常");}}
                    public void closed(String reason){lost(generation[0],reason);}
                    public void route(String value){if(socket==generation[0]){route=value;publish();}}
                });
                socket.start();
                worker.postAtTime(()->{if(socket==generation[0]&&!ready)lost(generation[0],"连接超时，正在重试");},this,SystemClock.uptimeMillis()+15000);
            }catch(Exception e){error="连接配置无效，请检查电脑设置";publish();}
        }
        void lost(HybridTransport ws,String reason){
            if(ws==null||socket!=ws||disposed||stopped)return;socket=null;ws.close();ready=false;error=reason;clientId="";listId="";clearApprovals();if(poll!=null)worker.removeCallbacks(poll);
            for(com.getcapacitor.PluginCall call:answers.values())call.reject("连接断开，请检查审批状态后重试");answers.clear();answerEvents.clear();
            retry=this::open;worker.postDelayed(retry,Math.min(15000,1000L<<Math.min(attempt++,4)));publish();
        }
        void requestList(){
            if(!listId.isEmpty()){if(SystemClock.elapsedRealtime()-listStarted<30000)return;send(json("type","cancel","id",listId));}
            listId="list-"+UUID.randomUUID();listStarted=SystemClock.elapsedRealtime();listRevision=eventRevision;
            send(json("type","call","id",listId,"endpoint","session/list","params",json()));
        }
        void frame(JSONObject f)throws Exception{
            lastFrame=SystemClock.elapsedRealtime();String type=f.optString("type"),id=f.optString("id");
            if(type.equals("ready")){
                if(f.optInt("protocol")!=1)throw new Exception();ready=true;attempt=0;error="";
                send(json("type","open","id","events","endpoint","$events","params",json()));requestList();
                poll=new Runnable(){public void run(){if(!ready||disposed)return;if(SystemClock.elapsedRealtime()-lastFrame>70000){lost(socket,"连接需要恢复");return;}send(json("type","ping"));requestList();worker.postDelayed(this,25000);}};worker.postDelayed(poll,25000);publish();return;
            }
            if(type.equals("item")&&id.equals("events")){event(f.getJSONObject("value"));return;}
            if(type.equals("error")&&id.equals(listId)){listId="";return;}
            if(type.equals("result")&&id.equals(listId)){
                listId="";
                JSONArray items=f.getJSONObject("value").getJSONArray("items");
                for(int i=0;i<items.length();i++){JSONObject s=items.getJSONObject(i);String session=s.getString("sessionId");if(sessionRevisions.getOrDefault(session,0L)<=listRevision)status(session,s.optBoolean("running"));}return;
            }
            com.getcapacitor.PluginCall answer=answers.remove(id);
            if(answer!=null){String eventId=answerEvents.remove(id);if(type.equals("result")){removeApproval(eventId);answer.resolve();}else answer.reject("审批未成功，请刷新后重试");return;}
            if((type.equals("error")||type.equals("end"))&&id.equals("events")){lost(socket,"审批订阅需要恢复");}
        }
        void status(String session,boolean active){Boolean previous=running.put(session,active);if(active&&!Boolean.TRUE.equals(previous))failed.remove(session);if(Boolean.TRUE.equals(previous)&&!active&&!failed.contains(session))notifyUser(this,session,"done","");}
        void event(JSONObject e)throws Exception{
            String type=e.optString("type");
            if(type.equals("ready")){clientId=e.getString("clientId");publish();return;}
            if(type.equals("cancel")){removeApproval(e.optString("eventId"));return;}
            if(type.equals("emit")||type.equals("event")){
                JSONArray args=e.optJSONArray("args");if(args==null)return;String name=e.optString("event");
                if(name.equals("api-session/status")){sessionRevisions.put(args.optString(0),++eventRevision);status(args.optString(0),args.optBoolean(1));}
                else if(name.equals("api-session/error")&&failed.add(args.optString(0)))notifyUser(this,args.optString(0),"error","");
                return;
            }
            if(!type.equals("waterfall"))return;
            String eventId=e.getString("eventId");
            if(!e.optString("event").equals("approval/request")){send(json("type","call","id",UUID.randomUUID().toString(),"endpoint","$events/result","params",json("clientId",clientId,"eventId",eventId,"outcome",json("kind","next"))));return;}
            JSONObject request=e.optJSONObject("request");if(request==null)request=json();String session=e.optString("agentId");
            JSONObject pending=json("deviceKey",key,"eventId",eventId,"clientId",clientId,"sessionId",session,"tool",request.optString("tool","工具操作"),"reason",request.optString("displayReason",request.optString("reason","此操作需要你的确认")));
            if(!approvals.containsKey(eventId)){approvals.put(eventId,pending);notifyUser(this,session,"approval",eventId);}publish();
        }
        void removeApproval(String eventId){if(approvals.remove(eventId)!=null){notices().cancel(noticeId(key+eventId));publish();}}
        void clearApprovals(){for(String id:approvals.keySet())notices().cancel(noticeId(key+id));approvals.clear();}
        void dispose(){disposed=true;if(retry!=null)worker.removeCallbacks(retry);if(poll!=null)worker.removeCallbacks(poll);worker.removeCallbacksAndMessages(this);HybridTransport old=socket;socket=null;if(old!=null)old.close();clearApprovals();for(com.getcapacitor.PluginCall call:answers.values())call.reject("已断开此电脑");answers.clear();}
    }
    @Override public void onDestroy(){
        stopped=true;foreground=false;instance=null;
        getSharedPreferences(PREFS,MODE_PRIVATE).edit().putLong("lastStoppedAt",System.currentTimeMillis()).putString("lastError",enabled(this)?"后台服务已停止，回到前台将自动恢复；红米/小米请检查自启动及省电策略":"").apply();
        try{network.unregisterNetworkCallback(networkCallback);}catch(Exception ignored){}
        worker.post(()->{for(Host h:hosts.values())h.dispose();hosts.clear();worker.removeCallbacksAndMessages(null);if(wake!=null&&wake.isHeld())wake.release();http.dispatcher().executorService().shutdown();http.connectionPool().evictAll();thread.quitSafely();});
        stopForeground(STOP_FOREGROUND_REMOVE);CompanionPlugin.changed("{\"enabled\":false,\"hosts\":[],\"approvals\":[]}");super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}
}
