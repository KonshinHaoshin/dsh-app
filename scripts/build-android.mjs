import {cp,mkdir,mkdtemp,copyFile,readFile,rm,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import{tmpdir}from'node:os';
import{fileURLToPath}from'node:url';
import path from'node:path';
// Build on the system volume: exFAT AppleDouble files can break Android's
// resource parser while Gradle creates directories, even after source cleanup.
const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const stage=await mkdtemp(path.join(tmpdir(),'dsh-android-'));
const filter=source=>!path.basename(source).startsWith('._')&&!['build','.gradle'].includes(path.basename(source));
await cp(path.join(root,'android'),path.join(stage,'android'),{recursive:true,filter});
await mkdir(path.join(stage,'node_modules/@capacitor'),{recursive:true});
for(const module of ['android','barcode-scanner','app','app-launcher'])await cp(path.join(root,'node_modules/@capacitor',module),path.join(stage,'node_modules/@capacitor',module),{recursive:true,filter});
const windows=process.platform==='win32';
if(!windows)await chmod(path.join(stage,'android/gradlew'),0o755);
const result=spawnSync(windows?'gradlew.bat':'./gradlew',['assembleDebug','--no-daemon','--console=plain'],{cwd:path.join(stage,'android'),shell:windows,stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'}});
if(result.status!==0){console.error('Android build failed; staged project:',stage);process.exitCode=result.status??1;}
else{await mkdir(path.join(root,'artifacts'),{recursive:true});const out=path.join(root,`artifacts/dsh-mobile-${version}-debug.apk`);await copyFile(path.join(stage,'android/app/build/outputs/apk/debug/app-debug.apk'),out);await rm(stage,{recursive:true,force:true});console.log('APK:',out);}
