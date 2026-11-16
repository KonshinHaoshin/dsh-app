import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const notes=(await readFile(path.join(root,'release-notes.md'),'utf8')).trim();
if(!notes||notes.length>4000)throw new Error('请填写 release-notes.md（最多 4000 字符）');
const gradle=await readFile(path.join(root,'android/app/build.gradle'),'utf8');
const versionCode=Number(gradle.match(/versionCode (\d+)/)?.[1]);
if(!versionCode||!gradle.includes(`versionName "${version}"`))throw new Error('Android 与 package.json 版本不一致');
const filename=`dsh-mobile-${version}-debug.apk`,source=path.join(root,'artifacts',filename);
const bytes=await readFile(source),sha256=createHash('sha256').update(bytes).digest('hex');
const dir=path.join(root,'releases',`v${version}`);await mkdir(dir,{recursive:true});
await writeFile(path.join(dir,'SHA256SUMS'),`${sha256}  ${filename}\n`);
// APK 不再提交到仓库，改作为 GitHub Release 资产发布；update.json 直接指向该资产。
await writeFile(path.join(root,'update.json'),JSON.stringify({schemaVersion:1,appId:'moe.shelterhub.dsh',version,versionCode,notes,android:{url:`https://github.com/KonshinHaoshin/dsh-app/releases/download/v${version}/${filename}`,sha256,size:bytes.length}},null,2)+'\n');
console.log('SHA256SUMS 与 update.json 已生成：',version);
console.log(`下一步：gh release create v${version} ${path.posix.join('artifacts',filename)} releases/v${version}/SHA256SUMS --title "DSH Android v${version}" --notes-file release-notes.md`);
