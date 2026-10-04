import {useCallback,useEffect,useState} from 'react';
import {Download,Loader2,RotateCcw} from 'lucide-react';
import {background} from '../messaging';
import {UPDATE_ORIGIN,type UpdateManifest,type UpdateStatus} from '../glossary-update';
function label(manifest:UpdateManifest){return [...new Set(manifest.packs.map(p=>p.version))].join(' / ')+` · ${manifest.revision.slice(0,8)}`;}
function count(manifest:UpdateManifest,group:string){return manifest.packs.filter(p=>p.group===group).reduce((sum,p)=>sum+p.count,0).toLocaleString();}
export function GlossaryUpdates({onChanged}:{onChanged:()=>Promise<void>}){
 const [status,setStatus]=useState<UpdateStatus>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{const next=await background('engine',{command:'glossary-status',payload:{}});if(next?.current)setStatus(next);},[]);
 useEffect(()=>{void refresh().catch(e=>setNotice((e as Error).message));const timer=setInterval(()=>void refresh().catch(()=>{}),3000);return()=>clearInterval(timer);},[refresh]);
 useEffect(()=>{const changed=(message:{target?:string;type?:string})=>{if(message.target==='ui'&&message.type==='glossary-updated'){void refresh();void onChanged().catch(e=>setNotice((e as Error).message));}};chrome.runtime.onMessage.addListener(changed);return()=>chrome.runtime.onMessage.removeListener(changed);},[refresh,onChanged]);
 async function action(command:string){
  setBusy(true);setNotice('');
  try{
   // Request optional access directly from the user's click, before asynchronous work.
   if(command==='glossary-check'&&!await chrome.permissions.request({origins:[UPDATE_ORIGIN]}))throw new Error('未授权更新域名，现有词库仍可离线使用。');
   const next:UpdateStatus=await background('engine',{command,payload:{revision:status?.available?.revision}});setStatus(next);
   if(command==='glossary-check')setNotice(next.available?'发现新词库，可查看数量后更新。':'当前词库已是最新版本。');
   else {await onChanged();setNotice(command==='glossary-apply'?'词库已更新，正在阅读的页面会重新翻译。':command==='glossary-rollback'?'已回退词库。':'已恢复插件附带的词库。');}
   await refresh();
  }catch(e){setNotice((e as Error).message);await refresh().catch(()=>{});}finally{setBusy(false);}
 }
 const working=busy||status?.busy;
 return <section className="panel glossary-updates" aria-label="词库在线更新">
  <div className="panel-heading"><h2>词库在线更新</h2><span className="badge">{status?.usingDownload?'已下载词库':'插件内置词库'}</span></div>
  <p className="mode-note">直接从 AM 官方仓库更新数学、物理、计算机词库，无需重装插件。个人术语、确认译名和禁用偏好保留；下载失败继续使用现有词库。</p>
  {status&&<p>当前版本：{label(status.current)}<br/><span className="muted">核心 {count(status.current,'core')} 条 · 扩展候选 {count(status.current,'extended')} 条{status.checkedAt&&` · 上次检查 ${new Date(status.checkedAt).toLocaleString('zh-CN')}`}</span></p>}
  {status?.available&&<div className="update-preview"><strong>可更新至 {label(status.available)}</strong><p>核心 {count(status.available,'core')} 条 · 扩展候选 {count(status.available,'extended')} 条</p></div>}
  <div className="panel-footer">
   <button className="secondary" disabled={working} onClick={()=>void action('glossary-check')}>{working?<Loader2 className="spin" size={16}/>:<Download size={16}/>}检查词库更新</button>
   {status?.available&&<button className="primary" disabled={working} onClick={()=>void action('glossary-apply')}>更新词库</button>}
   <button className="secondary" disabled={working||!status?.canRollback} onClick={()=>void action('glossary-rollback')}><RotateCcw size={16}/>回退上一版</button>
   {status?.usingDownload&&<button className="secondary" disabled={working} onClick={()=>void action('glossary-reset')}>恢复内置词库</button>}
  </div>
  {(notice||status?.error)&&<p className="mode-note" role="status">{notice||status?.error}</p>}
  <p className="mode-note">仅在点击检查或更新时联网。首次检查需要授权 GitHub 数据域名；插件代码更新仍需加载新安装包。</p>
 </section>;
}
