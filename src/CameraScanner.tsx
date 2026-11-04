import{useEffect,useRef}from'react';import{X}from'lucide-react';
export default function CameraScanner({onScan,onCancel,onError}:{onScan:(text:string)=>void;onCancel:()=>void;onError:(error:string)=>void}){
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let scanner:import('html5-qrcode').Html5Qrcode|undefined;let disposed=false;let active=false;let accepted=false;
    const stop=async()=>{if(active){active=false;try{await scanner?.stop();}catch{}}};
    void(async()=>{try{
      const{Html5Qrcode}=await import('html5-qrcode');if(disposed)return;
      scanner=new Html5Qrcode(host.current!.id,{formatsToSupport:[0],verbose:false});
      await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:250,height:250}},text=>{
        if(accepted||disposed)return;accepted=true;void stop().then(()=>{if(!disposed)onScan(text);});
      },()=>{});
      active=true;if(disposed)await stop();
    }catch(e){if(!disposed)onError(/permission|denied|NotAllowed/i.test(String(e))?'请允许使用相机后重试':'无法打开相机，可以使用配对链接');}})();
    return()=>{disposed=true;void stop();};
  },[]);
  return <><div className="sheet-top"><h2 id="settings-title">扫一扫</h2><button className="icon-button" aria-label="关闭相机" onClick={onCancel} autoFocus><X size={20}/></button></div><div id="dsh-camera-reader" ref={host} className="camera-reader"/><p className="pair-caption">扫描电脑上的 DSH 配对码</p></>;
}
