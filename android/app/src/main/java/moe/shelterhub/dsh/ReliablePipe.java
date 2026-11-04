package moe.shelterhub.dsh;

import org.json.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.*;

/** Worker-thread owned logical session. Replayed packets never redispatch a command. */
final class ReliablePipe {
    static final int MAX=8*1024*1024;
    final String session,epoch;final Consumer<JSONObject> deliver;final Runnable fatal;
    Function<String,Boolean> relay,direct;
    long sent,received,acked;int bytes,gapBytes;boolean closed;
    static final class Packet {final String raw;final int bytes;final JSONObject body;Packet(String raw,JSONObject body){this.raw=raw;this.bytes=raw.getBytes(StandardCharsets.UTF_8).length;this.body=body;}}
    final TreeMap<Long,Packet> pending=new TreeMap<>(),gaps=new TreeMap<>();
    ReliablePipe(String session,String epoch,Function<String,Boolean> relay,Consumer<JSONObject> deliver,Runnable fatal){this.session=session;this.epoch=epoch;this.relay=relay;this.deliver=deliver;this.fatal=fatal;}
    boolean write(String raw){if(closed)return false;if(direct!=null&&direct.apply(raw))return true;return relay!=null&&relay.apply(raw);}
    boolean send(JSONObject body){
        if(closed)return false;
        JSONObject f=CompanionService.json("type","p2p-packet","session",session,"epoch",epoch,"seq",++sent,"ack",received,"body",body);Packet p=new Packet(f.toString(),body);
        if(p.bytes>MAX||bytes+p.bytes>MAX*2||pending.size()>=2048){fail();return false;}pending.put(sent,p);bytes+=p.bytes;write(p.raw);return true;
    }
    void receive(String raw){
        if(closed)return;
        try{
            if(raw.getBytes(StandardCharsets.UTF_8).length>MAX)throw new Exception();JSONObject f=new JSONObject(raw);
            if(!session.equals(f.optString("session"))||!epoch.equals(f.optString("epoch")))return;
            String type=f.getString("type");long ack=f.getLong("ack");if(!Arrays.asList("p2p-packet","p2p-ack").contains(type)||ack<0||ack>sent||f.getDouble("ack")!=ack)throw new Exception();
            if(ack>acked){acked=ack;Iterator<Map.Entry<Long,Packet>> it=pending.entrySet().iterator();while(it.hasNext()){Map.Entry<Long,Packet> p=it.next();if(p.getKey()>ack)break;bytes-=p.getValue().bytes;it.remove();}}
            if(type.equals("p2p-ack"))return;
            long seq=f.getLong("seq");if(seq<1||f.getDouble("seq")!=seq)throw new Exception();JSONObject body=f.getJSONObject("body");
            if(seq>received&&!gaps.containsKey(seq)){Packet p=new Packet(raw,body);if(gaps.size()>=2048||gapBytes+p.bytes>MAX*2)throw new Exception();gaps.put(seq,p);gapBytes+=p.bytes;}
            while(gaps.containsKey(received+1)){Packet p=gaps.remove(++received);gapBytes-=p.bytes;deliver.accept(p.body);}
            write(CompanionService.json("type","p2p-ack","session",session,"epoch",epoch,"ack",received).toString());
        }catch(Exception e){fail();}
    }
    void replay(){for(Packet p:new ArrayList<>(pending.values()))write(p.raw);}
    void direct(Function<String,Boolean> send){direct=send;replay();}
    void close(){closed=true;pending.clear();gaps.clear();bytes=gapBytes=0;direct=null;relay=null;}
    void fail(){if(closed)return;close();fatal.run();}
}
