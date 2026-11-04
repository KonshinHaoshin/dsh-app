export class RtcWire {
 constructor(channel:any,receive:(raw:string)=>void,fatal:()=>void);
 send(raw:string):boolean;accept(bytes:ArrayBuffer|Uint8Array):void;tick():void;close():void;
}
