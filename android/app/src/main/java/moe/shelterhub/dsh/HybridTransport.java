package moe.shelterhub.dsh;

import android.content.Context;
import android.os.*;
import org.json.*;
import org.webrtc.*;
import okhttp3.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.*;
import java.nio.charset.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.*;

/** WSS + data-only native WebRTC, independent of Activity and WebView lifecycle. */
final class HybridTransport {
    interface Listener {void frame(JSONObject frame);void closed(String reason);void route(String route);}
    static PeerConnectionFactory factory;static synchronized PeerConnectionFactory factory(Context context){
        if(factory==null){PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context.getApplicationContext()).createInitializationOptions());factory=PeerConnectionFactory.builder().createPeerConnectionFactory();}return factory;
    }
    static String hex(byte[] data){StringBuilder b=new StringBuilder();for(byte v:data)b.append(String.format("%02x",v&255));return b.toString();}
    static String sign(String token,String... parts)throws Exception{Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(token.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));return hex(mac.doFinal(("dsh-p2p-v1\n"+String.join("\n",parts)).getBytes(StandardCharsets.UTF_8)));}
    static boolean proof(String token,String actual,String... parts)throws Exception{return actual.matches("[a-f0-9]{64}")&&MessageDigest.isEqual(actual.getBytes(StandardCharsets.UTF_8),sign(token,parts).getBytes(StandardCharsets.UTF_8));}
    final Context context;final Handler worker;final OkHttpClient http;final Listener listener;final String url,token,deviceId;final boolean publicMode;
    final String session=UUID.randomUUID().toString();String epoch="",nonce="",attempt="";boolean disposed,joined,direct;long started,lastPong,lastProbe,lastReplay,nextProbe;
    WebSocket ws;ReliablePipe pipe;PeerConnection pc;DataChannel dc;JSONObject ready;JSONArray iceServers;Runnable retry;
    final ArrayList<IceCandidate> candidates=new ArrayList<>();final ArrayDeque<byte[]> outgoing=new ArrayDeque<>();int outgoingBytes,transfer;
    static final class Assembly{int count,bytes;long at=SystemClock.elapsedRealtime();Map<Integer,byte[]> parts=new HashMap<>();Assembly(int count){this.count=count;}}
    final Map<Integer,Assembly> incoming=new HashMap<>();
    HybridTransport(Context context,Handler worker,OkHttpClient http,String url,String token,String deviceId,boolean publicMode,Listener listener){this.context=context;this.worker=worker;this.http=http;this.url=url;this.token=token;this.deviceId=deviceId;this.publicMode=publicMode;this.listener=listener;}
    void start(){openRelay();worker.post(tick);}
    boolean raw(JSONObject f){return raw(f.toString());}boolean raw(String raw){return ws!=null&&ws.send(raw);}
    void openRelay(){
        if(disposed)return;
        ws=http.newWebSocket(new Request.Builder().url(url).build(),new WebSocketListener(){
            @Override public void onOpen(WebSocket socket,Response response){worker.post(()->{if(ws!=socket)return;try{JSONObject hello=CompanionService.json("type","hello","deviceId",deviceId);if(publicMode)hello.put("tokenDigest",hex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))));else hello.put("token",token);raw(hello);}catch(Exception e){finish("连接验证失败");}});}
            @Override public void onMessage(WebSocket socket,String text){worker.post(()->{if(ws!=socket)return;try{receive(text);}catch(Exception e){finish("连接验证失败");}});}
            @Override public void onFailure(WebSocket socket,Throwable error,Response response){worker.post(()->lost(socket));}
            @Override public void onClosing(WebSocket socket,int code,String reason){socket.close(code,null);worker.post(()->lost(socket));}
            @Override public void onClosed(WebSocket socket,int code,String reason){worker.post(()->lost(socket));}
        });
        WebSocket generation=ws;worker.postDelayed(()->{if(ws==generation&&ready==null)lost(generation);},15000);
    }
    void lost(WebSocket socket){if(ws!=socket||disposed)return;ws=null;socket.cancel();if(direct){retry=this::openRelay;worker.postDelayed(retry,1500);}else finish("电脑暂时离线，正在自动重连");}
    void receive(String raw)throws Exception{
        if(raw.getBytes(StandardCharsets.UTF_8).length>ReliablePipe.MAX)throw new Exception();JSONObject f=new JSONObject(raw);String type=f.optString("type");
        if(type.equals("ready")){
            JSONArray features=f.optJSONArray("features");boolean supports=false;if(features!=null)for(int i=0;i<features.length();i++)if(features.optString(i).equals("p2p-v1"))supports=true;
            if(publicMode&&supports){ready=f;nonce=UUID.randomUUID().toString();raw(CompanionService.json("type","p2p-join","session",session,"nonce",nonce,"proof",sign(token,"join",session,nonce)));}
            else{ready=f;listener.route(publicMode?"relay":"lan");listener.frame(f);}return;
        }
        if(type.equals("p2p-joined")){
            JSONArray servers=f.getJSONArray("iceServers");String serverJson=servers.toString(),newEpoch=f.getString("epoch");
            if(!session.equals(f.optString("session"))||!nonce.equals(f.optString("nonce"))||servers.length()>4||!proof(token,f.optString("proof"),"joined",session,newEpoch,nonce,serverJson))throw new Exception();
            if(!epoch.isEmpty()&&!epoch.equals(newEpoch)){finish("电脑已重启，请检查任务状态");return;}epoch=newEpoch;iceServers=servers;
            if(pipe==null)pipe=new ReliablePipe(session,epoch,s->raw(s),listener::frame,()->finish("连接缓冲已满，请检查任务状态"));pipe.replay();
            if(!joined){joined=true;listener.route("relay");listener.frame(ready);}if(pc==null)negotiate();return;
        }
        if(type.equals("p2p-packet")||type.equals("p2p-ack")){if(pipe!=null)pipe.receive(raw);return;}
        if(type.equals("p2p-reset")&&session.equals(f.optString("session"))){finish("会话连接需要重新同步");return;}
        if(type.equals("p2p-signal")){
            String kind=f.optString("kind"),data=f.optString("data");if(!session.equals(f.optString("session"))||!epoch.equals(f.optString("epoch"))||!attempt.equals(f.optString("attempt"))||!f.optString("role").equals("host")||data.length()>65536||!Arrays.asList("answer","candidate").contains(kind)||!proof(token,f.optString("proof"),"signal",session,epoch,attempt,"host",kind,data))return;
            PeerConnection generation=pc;if(generation==null)return;try{JSONObject value=new JSONObject(data);
            if(kind.equals("answer"))generation.setRemoteDescription(new Sdp(){@Override public void onSetSuccess(){worker.post(()->{if(pc!=generation)return;for(IceCandidate c:candidates)generation.addIceCandidate(c);candidates.clear();});}@Override public void onSetFailure(String error){worker.post(()->{if(pc==generation)dropDirect();});}},new SessionDescription(SessionDescription.Type.ANSWER,value.getString("sdp")));
            else{IceCandidate c=new IceCandidate(value.optString("sdpMid","0"),value.optInt("sdpMLineIndex",0),value.getString("candidate"));if(generation.getRemoteDescription()!=null)generation.addIceCandidate(c);else if(candidates.size()<100)candidates.add(c);}}catch(Exception e){if(pc==generation)dropDirect();}return;
        }
        if(!joined)listener.frame(f);
    }
    void signal(String kind,String data){try{raw(CompanionService.json("type","p2p-signal","session",session,"epoch",epoch,"attempt",attempt,"role","phone","kind",kind,"data",data,"proof",sign(token,"signal",session,epoch,attempt,"phone",kind,data)));}catch(Exception e){dropDirect();}}
    void negotiate(){
        if(disposed||iceServers==null)return;
        try{
            ArrayList<PeerConnection.IceServer> servers=new ArrayList<>();for(int i=0;i<iceServers.length();i++){String value=iceServers.getJSONObject(i).getString("urls");if(!value.startsWith("stun:"))return;servers.add(PeerConnection.IceServer.builder(value).createIceServer());}
            attempt=UUID.randomUUID().toString();started=SystemClock.elapsedRealtime();candidates.clear();PeerConnection.RTCConfiguration config=new PeerConnection.RTCConfiguration(servers);config.sdpSemantics=PeerConnection.SdpSemantics.UNIFIED_PLAN;
            final String rtcAttempt=attempt;
            pc=factory(context).createPeerConnection(config,new PeerConnection.Observer(){
                public void onSignalingChange(PeerConnection.SignalingState state){}public void onIceConnectionReceivingChange(boolean receiving){}public void onIceGatheringChange(PeerConnection.IceGatheringState state){}public void onIceCandidatesRemoved(IceCandidate[] candidates){}public void onAddStream(MediaStream stream){}public void onRemoveStream(MediaStream stream){}public void onDataChannel(DataChannel channel){channel.close();}public void onRenegotiationNeeded(){}
                public void onIceCandidate(IceCandidate candidate){String generation=rtcAttempt;worker.post(()->{if(pc!=null&&attempt.equals(generation))signal("candidate",CompanionService.json("candidate",candidate.sdp,"sdpMid",candidate.sdpMid,"sdpMLineIndex",candidate.sdpMLineIndex).toString());});}
                public void onIceConnectionChange(PeerConnection.IceConnectionState state){String generation=rtcAttempt;worker.post(()->{if(attempt.equals(generation)&&Arrays.asList(PeerConnection.IceConnectionState.FAILED,PeerConnection.IceConnectionState.DISCONNECTED,PeerConnection.IceConnectionState.CLOSED).contains(state))dropDirect();});}
            });
            if(pc==null)throw new Exception();PeerConnection generation=pc;DataChannel channel=pc.createDataChannel("dsh-p2p-v1",new DataChannel.Init());dc=channel;
            channel.registerObserver(new DataChannel.Observer(){public void onBufferedAmountChange(long previous){worker.post(()->{if(dc==channel)flush();});}public void onStateChange(){worker.post(()->{if(dc==channel&&channel.state()==DataChannel.State.CLOSED)dropDirect();});}public void onMessage(DataChannel.Buffer buffer){byte[] bytes=new byte[buffer.data.remaining()];buffer.data.get(bytes);worker.post(()->{if(dc==channel){if(!buffer.binary)dropDirect();else accept(bytes);}});}});
            pc.createOffer(new Sdp(){@Override public void onCreateSuccess(SessionDescription offer){worker.post(()->{if(pc!=generation)return;signal("offer",CompanionService.json("type","offer","sdp",offer.description).toString());generation.setLocalDescription(new Sdp(){@Override public void onSetFailure(String error){worker.post(()->{if(pc==generation)dropDirect();});}},offer);});}@Override public void onCreateFailure(String error){worker.post(()->{if(pc==generation)dropDirect();});}},new MediaConstraints());
        }catch(Throwable e){dropDirect();}
    }
    static class Sdp implements SdpObserver{public void onCreateSuccess(SessionDescription description){}public void onSetSuccess(){}public void onCreateFailure(String error){}public void onSetFailure(String error){}}
    boolean directSend(String raw){
        if(dc==null||dc.state()!=DataChannel.State.OPEN)return false;byte[] bytes=raw.getBytes(StandardCharsets.UTF_8);int count=(bytes.length+15999)/16000;
        if(bytes.length>ReliablePipe.MAX||outgoingBytes+bytes.length>ReliablePipe.MAX*2){dropDirect();return false;}int id=++transfer;
        for(int i=0;i<count;i++){int start=i*16000,length=Math.min(16000,bytes.length-start);ByteBuffer b=ByteBuffer.allocate(8+length).order(ByteOrder.BIG_ENDIAN);b.putInt(id).putShort((short)i).putShort((short)count).put(bytes,start,length);outgoing.add(b.array());outgoingBytes+=b.capacity();}flush();return true;
    }
    void flush(){try{while(dc!=null&&dc.state()==DataChannel.State.OPEN&&!outgoing.isEmpty()&&dc.bufferedAmount()<256*1024){byte[] bytes=outgoing.remove();outgoingBytes-=bytes.length;if(!dc.send(new DataChannel.Buffer(ByteBuffer.wrap(bytes),true))){dropDirect();return;}}}catch(Exception e){dropDirect();}}
    void accept(byte[] bytes){
        try{
            if(bytes.length<=8||bytes.length>16008)throw new Exception();ByteBuffer b=ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN);int id=b.getInt(),index=Short.toUnsignedInt(b.getShort()),count=Short.toUnsignedInt(b.getShort());if(count<1||count>525||index>=count)throw new Exception();
            Assembly a=incoming.get(id);if(a==null){if(incoming.size()>=4)throw new Exception();a=new Assembly(count);incoming.put(id,a);}if(a.count!=count)throw new Exception();
            if(!a.parts.containsKey(index)){byte[] part=Arrays.copyOfRange(bytes,8,bytes.length);a.parts.put(index,part);a.bytes+=part.length;if(a.bytes>ReliablePipe.MAX)throw new Exception();}
            if(a.parts.size()==count){ByteBuffer full=ByteBuffer.allocate(a.bytes);for(int i=0;i<count;i++)full.put(a.parts.get(i));incoming.remove(id);String raw=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(full.array())).toString();JSONObject f=new JSONObject(raw);String type=f.optString("type");
                if(type.equals("p2p-direct")&&session.equals(f.optString("session"))&&epoch.equals(f.optString("epoch"))&&attempt.equals(f.optString("attempt"))){direct=true;lastPong=SystemClock.elapsedRealtime();pipe.direct(this::directSend);listener.route("p2p");}
                else if(type.equals("p2p-pong"))lastPong=SystemClock.elapsedRealtime();else if(pipe!=null)pipe.receive(raw);
            }
        }catch(Exception e){dropDirect();}
    }
    void dropDirect(){
        PeerConnection old=pc;DataChannel oldDc=dc;pc=null;dc=null;attempt="";direct=false;candidates.clear();outgoing.clear();outgoingBytes=0;incoming.clear();nextProbe=SystemClock.elapsedRealtime()+60000;
        if(oldDc!=null){oldDc.unregisterObserver();oldDc.close();oldDc.dispose();}if(old!=null){old.close();old.dispose();}if(pipe!=null)pipe.direct(null);
        if(joined&&!disposed)listener.route("relay");if(ws==null&&!disposed)finish("网络需要重新连接");
    }
    void send(JSONObject f){if(disposed)return;if(joined)pipe.send(f);else raw(f);}
    final Runnable tick=new Runnable(){public void run(){if(disposed)return;long now=SystemClock.elapsedRealtime();flush();for(Assembly a:incoming.values())if(now-a.at>30000){dropDirect();break;}
        if(direct){if(now-lastPong>15000)dropDirect();else if(now-lastProbe>5000){lastProbe=now;directSend(CompanionService.json("type","p2p-probe","at",now).toString());}}
        else if(pc!=null&&now-started>12000)dropDirect();else if(joined&&pc==null&&nextProbe>0&&now>nextProbe&&ws!=null){nextProbe=now+60000;negotiate();}
        if(pipe!=null&&now-lastReplay>2000&&outgoing.isEmpty()){lastReplay=now;pipe.replay();}worker.postDelayed(this,outgoing.isEmpty()?1000:50);
    }};
    void close(){if(disposed)return;if(joined)raw(CompanionService.json("type","p2p-close","session",session,"epoch",epoch));dispose();}
    void finish(String reason){if(disposed)return;dispose();listener.closed(reason);}
    void dispose(){disposed=true;worker.removeCallbacks(tick);if(retry!=null)worker.removeCallbacks(retry);if(pipe!=null)pipe.close();dropDirect();WebSocket old=ws;ws=null;if(old!=null)old.cancel();}
}
