const fs=require('node:fs');
const assert=require('node:assert/strict');
const {transformSync}=require('esbuild');
const mod={exports:{}};
new Function('module','exports',transformSync(fs.readFileSync('src/dependencies.ts','utf8'),{loader:'ts',format:'cjs'}).code)(mod,mod.exports);
const {ensureDependencies}=mod.exports;
function fixture({missing=[3658110,1628350],failure=false,cancel=false,other=false,auto=false}={}) {
  let installed=false,ticks=0,continued=false;const calls=[];
  const tools=[{appid:3658110,name:'Proton'},{appid:1628350,name:'sniper'}];
  const read=async()=>({ok:true,library:'/steam',dependencies:tools.map(t=>({...t,installed:installed||!missing.includes(t.appid)}))});
  const steam={InstallFolder:{GetInstallFolders:async()=>[{strFolderPath:'/steam',nFolderIndex:0,bIsMounted:true}]},Installs:{
    GetInstallManagerInfo:async()=>({eInstallState:other?7:!ticks?0:failure?15:cancel?16:auto||continued?14:7,errorDetail:'disk full',rgApps:(auto||continued?[]:missing).map(nAppID=>({nAppID}))}),
    OpenInstallWizard:async ids=>calls.push(['install',ids]),SetInstallFolder:async id=>calls.push(['folder',id]),SetCreateShortcuts:async()=>{},
    ContinueInstall:async()=>{continued=true;calls.push(['start'])},
  }};
  const wait=async()=>{ticks++;if(ticks===3&&(continued||auto))installed=true;};
  return {run:()=>ensureDependencies(steam,read,()=>{},wait,()=>ticks*1000),calls};
}
(async()=>{
  let f=fixture();await f.run();assert.deepEqual(f.calls,[['install',[3658110,1628350]],['folder',0],['start']]);
  f=fixture({missing:[3658110]});await f.run();assert.deepEqual(f.calls[0],['install',[3658110]]);
  f=fixture({missing:[]});await f.run();assert.equal(f.calls.length,0);
  f=fixture({failure:true});await assert.rejects(f.run(),/disk full/);
  f=fixture({cancel:true});await assert.rejects(f.run(),/취소/);
  f=fixture({other:true});await assert.rejects(f.run(),/다른 Steam/);assert.equal(f.calls.length,0);
  f=fixture({auto:true});await f.run();assert.equal(f.calls.length,1);
  console.log('7 dependency installation scenarios passed');
})().catch(e=>{console.error(e);process.exitCode=1});
