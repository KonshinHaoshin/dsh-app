import{readdir,rm}from'node:fs/promises';
import{spawnSync}from'node:child_process';
import path from'node:path';
async function clean(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const target=path.join(dir,entry.name);if(entry.name.startsWith('._'))await rm(target,{recursive:true,force:true});else if(entry.isDirectory())await clean(target);}}
await clean('dist');
const windows=process.platform==='win32';
const result=spawnSync(windows?'npx.cmd':'npx',['cap','sync',process.argv[2]??'android'],{shell:windows,stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'}});process.exitCode=result.status??1;
