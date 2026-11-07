const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const React = require('react');
const {createRoot} = require('react-dom/client');
const {transformSync} = require('esbuild');
const assert = require('node:assert/strict');
const dom = new JSDOM('<div id="root"></div>');
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;
const calls=[];let installed=false;let registered=false;const id=0x90000001;
global.App={m_CurrentUser:{strSteamID:'76561197960265851'}};
global.appStore={GetAppOverviewByAppID:()=>registered?{}:null};
global.SteamClient={Apps:{
  AddShortcut:async()=>{calls.push('add');registered=true;return id},
  RemoveShortcut:()=>{calls.push('remove');registered=false},
  SetShortcutName(){},SetShortcutExe(){},SetShortcutStartDir(){},SetShortcutLaunchOptions(){},SetShortcutIcon(){calls.push('icon')},
  ClearCustomArtworkForApp:async()=>{},SetCustomArtworkForApp:async(_id,_data,_format,type)=>calls.push('art'+type),SetCustomLogoPositionForApp:async()=>{}
}};
const backend={
 status:()=>({ok:true,installed,registered,appid:installed?id:undefined}),
 prepare_install:()=>({ok:true,name:'POE2 Launcher',exe:'/bin/bash',home:'/home/deck',options:'launcher',icon:'icon.png'}),
 finish_install:()=>{installed=true;calls.push('finish');return {ok:true}},
 prepare_remove:()=>({ok:true,appid:id}),
 finish_remove:()=>{installed=false;calls.push('clean');return {ok:true}},
 artwork:([name])=>({ok:true,type:{capsule:0,hero:1,logo:2,wide:3}[name],data:'fixture'})
};
const api={callable:(name)=>async(...args)=>backend[name](args),definePlugin:f=>f,toaster:{toast(){}}};
const ui={PanelSection:({children})=>React.createElement('section',null,children),PanelSectionRow:({children})=>React.createElement('div',null,children),ButtonItem:({children,onClick,disabled})=>React.createElement('button',{onClick,disabled},children),staticClasses:{Title:'title'}};
const code=transformSync(fs.readFileSync('src/index.tsx','utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
const output={exports:{}};
new Function('require','module','exports',code)(name=>name==='@decky/api'?api:name==='@decky/ui'?ui:name==='react-icons/fa'?{FaDragon:()=>null}:require(name),output,output.exports);
const plugin=output.exports.default();
const root=createRoot(document.getElementById('root'));root.render(plugin.content);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(text){for(let i=0;i<80;i++){if(document.body.textContent.includes(text))return;await sleep(100)}throw Error(document.body.textContent)}
(async()=>{
 await wait('런처 설치');await sleep(100);
 document.querySelector('button').click();await wait('설치 완료.');
 assert.equal(calls.filter(x=>x==='add').length,1);
 assert.deepEqual(calls.filter(x=>x.startsWith('art')),['art0','art1','art2','art3']);
 assert(calls.includes('icon'));
 document.querySelectorAll('button')[1].click();await wait('런처·라이브러리 제거 완료');
 assert(calls.includes('remove'));assert(calls.includes('clean'));assert.equal(installed,false);
 root.unmount();console.log('Frontend install/register/5-artwork/remove flow passed');
})().catch(e=>{console.error(e);process.exitCode=1});
