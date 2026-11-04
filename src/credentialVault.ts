import {Capacitor,registerPlugin} from '@capacitor/core';
import {credentialKey,serializeDevices} from './devices';
import type {SavedDevice} from './devices';
const native=registerPlugin<{get(options:{key:string}):Promise<{value:string|null}>;set(options:{key:string;value:string}):Promise<void>;remove(options:{key:string}):Promise<void>;getRegistry():Promise<{value:string|null}>;setRegistry(options:{value:string}):Promise<void>}>('DeviceCredentials');
export const credentialVault={
  async getRegistry(){return Capacitor.getPlatform()==='android'?(await native.getRegistry()).value:null;},
  async saveRegistry(devices:SavedDevice[]){if(Capacitor.getPlatform()==='android')await native.setRegistry({value:serializeDevices(devices)});},
  async get(key:string){
    if(Capacitor.getPlatform()==='android'){const result=await native.get({key});return result.value??sessionStorage.getItem(credentialKey(key))??'';}
    return sessionStorage.getItem(credentialKey(key))??'';
  },
  async set(key:string,value:string){
    if(Capacitor.getPlatform()==='android')await native.set({key,value});
    sessionStorage.setItem(credentialKey(key),value);
  },
  async remove(key:string){
    if(Capacitor.getPlatform()==='android')await native.remove({key});
    sessionStorage.removeItem(credentialKey(key));
  }
};
