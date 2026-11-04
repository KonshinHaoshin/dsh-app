export class ReliablePipe {
 constructor(session:string,epoch:string,options:{relay:(raw:string)=>boolean;deliver:(body:any)=>void;fatal:()=>void});
 send(body:any):boolean;receive(raw:string):void;replay():void;setDirect(send:((raw:string)=>boolean)|null):void;setRelay(send:((raw:string)=>boolean)|null):void;close():void;
}
