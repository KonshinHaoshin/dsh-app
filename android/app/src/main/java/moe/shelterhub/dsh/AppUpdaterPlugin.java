package moe.shelterhub.dsh;

import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.URI;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;

@CapacitorPlugin(name="AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final ExecutorService worker=Executors.newSingleThreadExecutor();
    private static final OkHttpClient http=new OkHttpClient.Builder().followRedirects(false).connectTimeout(15,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).build();
    private static volatile boolean downloading;
    private static volatile long received,total;
    @PluginMethod public void status(PluginCall call){JSObject result=new JSObject();result.put("downloading",downloading);result.put("received",received);result.put("total",total);result.put("version",getContext().getSharedPreferences("dsh-updater",Context.MODE_PRIVATE).getString("version",""));result.put("ready",apk().isFile()&&!getContext().getSharedPreferences("dsh-updater",Context.MODE_PRIVATE).getString("sha256","").isEmpty());call.resolve(result);}
    private File apk(){return new File(getContext().getCacheDir(),"updates/dsh-update.apk");}
    static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format("%02x",b&255));return s.toString();}
    private static String digest(File file)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] buf=new byte[65536];int n;while((n=in.read(buf))!=-1)d.update(buf,0,n);}return hex(d.digest());}
    private long version(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}
    private PackageInfo archive(File file)throws Exception{
        PackageManager pm=getContext().getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo installed=pm.getPackageInfo(getContext().getPackageName(),flags), candidate=pm.getPackageArchiveInfo(file.getPath(),flags);
        if(candidate==null||!getContext().getPackageName().equals(candidate.packageName)||version(candidate)<=version(installed))throw new IOException("安装包不适用于此应用或不是更新版本");
        Signature[] a=Build.VERSION.SDK_INT>=28?installed.signingInfo.getApkContentsSigners():installed.signatures,b=Build.VERSION.SDK_INT>=28?candidate.signingInfo.getApkContentsSigners():candidate.signatures;
        if(a==null||b==null||a.length!=b.length)throw new IOException("安装包签名不一致");
        Set<String> signatures=new HashSet<>();for(Signature sign:a)signatures.add(hex(MessageDigest.getInstance("SHA-256").digest(sign.toByteArray())));
        for(Signature sign:b)if(!signatures.contains(hex(MessageDigest.getInstance("SHA-256").digest(sign.toByteArray()))))throw new IOException("安装包签名不一致，请使用同一来源的更新包");
        return candidate;
    }
    @PluginMethod public synchronized void download(PluginCall call){
        if(downloading){call.reject("正在下载，请稍候");return;}
        String url=call.getString("url"),sha=call.getString("sha256"),release=call.getString("version");Double length=call.getDouble("size");Integer code=call.getInt("versionCode");
        try{
            URI u=new URI(url);String path="/KonshinHaoshin/dsh-app/v"+release+"/releases/v"+release+"/dsh-mobile-"+release+"-debug.apk";
            if(release==null||!release.matches("\\d+\\.\\d+\\.\\d+")||!u.getScheme().equals("https")||!"raw.githubusercontent.com".equals(u.getHost())||u.getPort()!=-1||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||!path.equals(u.getPath())||sha==null||!sha.matches("[a-fA-F0-9]{64}")||length==null||length<1||length>120*1024*1024||code==null)throw new Exception();
        }catch(Exception e){call.reject("更新地址或校验信息无效");return;}
        synchronized(AppUpdaterPlugin.class){if(downloading){call.reject("正在下载，请稍候");return;}downloading=true;}received=0;total=length.longValue();
        worker.execute(()->{
            File temp=new File(getContext().getCacheDir(),"updates/downloading.tmp");File target=apk();
            try{
                if(!temp.getParentFile().isDirectory()&&!temp.getParentFile().mkdirs())throw new IOException("无法创建下载目录");
                target.delete();getContext().getSharedPreferences("dsh-updater",Context.MODE_PRIVATE).edit().clear().commit();
                try(Response response=http.newCall(new Request.Builder().url(url).get().build()).execute()){
                    if(!response.isSuccessful()||response.body()==null)throw new IOException("下载失败（HTTP "+response.code()+"）");
                    long size=0,last=0;try(InputStream in=response.body().byteStream();FileOutputStream out=new FileOutputStream(temp)){
                        byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){size+=n;received=size;if(size>length.longValue())throw new IOException("安装包大小不匹配");out.write(buffer,0,n);long now=System.currentTimeMillis();if(now-last>300){JSObject progress=new JSObject();progress.put("received",size);progress.put("total",length.longValue());notifyListeners("progress",progress);last=now;}}out.getFD().sync();
                    }
                    if(size!=length.longValue()||!digest(temp).equalsIgnoreCase(sha))throw new IOException("安装包完整性校验失败，请重试");
                }
                PackageInfo pkg=archive(temp);if(version(pkg)!=code.longValue()||!release.equals(pkg.versionName))throw new IOException("安装包版本与更新清单不一致");
                if(!temp.renameTo(target))throw new IOException("无法保存安装包");
                if(!getContext().getSharedPreferences("dsh-updater",Context.MODE_PRIVATE).edit().putString("sha256",sha).putString("version",release).commit())throw new IOException("无法保存更新校验信息");
                JSObject result=new JSObject();result.put("ready",true);call.resolve(result);
            }catch(Exception e){temp.delete();target.delete();call.reject(e instanceof IOException?e.getMessage():"下载失败，请检查网络后重试");}
            finally{downloading=false;}
        });
    }
    @PluginMethod public void install(PluginCall call){
        worker.execute(()->{try{
            File file=apk();String expected=getContext().getSharedPreferences("dsh-updater",Context.MODE_PRIVATE).getString("sha256","");
            if(!file.isFile()||expected.isEmpty()||!expected.equalsIgnoreCase(digest(file)))throw new IOException("请先下载并校验更新");archive(file);
            getActivity().runOnUiThread(()->{try{
                JSObject result=new JSObject();if(!getContext().getPackageManager().canRequestPackageInstalls()){
                    getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getContext().getPackageName())));result.put("permissionRequired",true);
                }else{
                    Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file);
                    getActivity().startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));result.put("started",true);
                }call.resolve(result);
            }catch(Exception e){call.reject("无法打开系统安装界面，请稍后重试");}});
        }catch(Exception e){call.reject(e.getMessage()==null?"安装前校验失败":e.getMessage());}});
    }
}
