package moe.shelterhub.dsh;

import android.content.Context;
import android.security.keystore.*;
import android.util.AtomicFile;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.*;

/** Bounded, encrypted preview cache. Cache failures never affect pairing or tasks. */
@CapacitorPlugin(name="SessionCache")
public class SessionCachePlugin extends Plugin {
    private static final ExecutorService io=Executors.newSingleThreadExecutor();
    private static final String ALIAS="moe.shelterhub.dsh.session_cache.v1";
    private static final int MAX=512*1024,TOTAL=8*1024*1024,COUNT=32;
    private static final long TTL=7*24*60*60*1000L;
    private static SecretKey key()throws Exception{
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return(SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return generator.generateKey();
    }
    private static File directory(Context context)throws IOException{File dir=new File(context.getFilesDir(),"session-cache");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException();return dir;}
    private static boolean valid(String key){return key!=null&&key.matches("[a-f0-9]{64}\\.[a-f0-9]{64}");}
    private static void prune(File dir){
        File[] files=dir.listFiles(f->valid(f.getName()));if(files==null)return;Arrays.sort(files,Comparator.comparingLong(File::lastModified).reversed());long total=0;int count=0;
        for(File file:files){total+=file.length();count++;if(count>COUNT||total>TOTAL||System.currentTimeMillis()-file.lastModified()>TTL)new AtomicFile(file).delete();}
    }
    @PluginMethod public void get(PluginCall call){
        String name=call.getString("key");Context context=getContext().getApplicationContext();
        io.execute(()->{String value=null;File file=null;try{
            if(!valid(name))throw new IOException();file=new File(directory(context),name);
            if(file.isFile()&&file.length()<=MAX+28){byte[] encoded=new AtomicFile(file).readFully();if(encoded.length<28)throw new IOException();
                Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOf(encoded,12)));cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));value=new String(cipher.doFinal(Arrays.copyOfRange(encoded,12,encoded.length)),StandardCharsets.UTF_8);
                long at=new JSONObject(value).getLong("savedAt");if(System.currentTimeMillis()-at>TTL||at>System.currentTimeMillis()+60000)throw new IOException();file.setLastModified(System.currentTimeMillis());
            }
        }catch(Exception ignored){value=null;if(file!=null)new AtomicFile(file).delete();}
        JSObject result=new JSObject();result.put("value",value==null?JSONObject.NULL:value);call.resolve(result);});
    }
    @PluginMethod public void set(PluginCall call){
        String name=call.getString("key"),value=call.getString("value");Context context=getContext().getApplicationContext();
        io.execute(()->{try{
            if(!valid(name)||value==null||value.getBytes(StandardCharsets.UTF_8).length>MAX)throw new IOException();
            File dir=directory(context);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));byte[] encrypted=cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            AtomicFile target=new AtomicFile(new File(dir,name));FileOutputStream out=null;try{out=target.startWrite();out.write(cipher.getIV());out.write(encrypted);target.finishWrite(out);}catch(Exception error){target.failWrite(out);throw error;}
            prune(dir);call.resolve();
        }catch(Exception ignored){call.reject("无法保存会话缓存");}});
    }
    @PluginMethod public void removeDevice(PluginCall call){
        String prefix=call.getString("prefix");Context context=getContext().getApplicationContext();
        io.execute(()->{try{if(prefix==null||!prefix.matches("[a-f0-9]{64}"))throw new IOException();File[] files=directory(context).listFiles(f->valid(f.getName())&&f.getName().startsWith(prefix+"."));if(files!=null)for(File file:files)new AtomicFile(file).delete();call.resolve();}catch(Exception ignored){call.reject("无法清除会话缓存");}});
    }
}
