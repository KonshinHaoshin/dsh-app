import {Capacitor} from '@capacitor/core';
import {fetchAppUpdate,isNewerVersion,parseAppUpdate} from './updates';
import type {AppUpdate} from './updates';
const KEY='dsh.update-available',LAST='dsh.update-last-check';
export function cachedUpdate(version:string):AppUpdate|null{try{const value=parseAppUpdate(JSON.parse(localStorage.getItem(KEY)??'null'));return isNewerVersion(value.version,version)?value:null;}catch{return null;}}
export function saveUpdate(update:AppUpdate,current:string){if(isNewerVersion(update.version,current))localStorage.setItem(KEY,JSON.stringify(update));else localStorage.removeItem(KEY);localStorage.setItem(LAST,String(Date.now()));window.dispatchEvent(new Event('dsh-update-available'));}
let flight:Promise<void>|undefined;
export async function checkUpdateInBackground(){
 if(Capacitor.getPlatform()!=='android'||Date.now()-Number(localStorage.getItem(LAST)??0)<86400000)return;
 return flight??=(async()=>{try{const{App}=await import('@capacitor/app');const info=await App.getInfo();saveUpdate(await fetchAppUpdate(),info.version);}catch{/* Manual checks surface failures; quiet startup checks never interrupt work. */}finally{flight=undefined;}})();
}
