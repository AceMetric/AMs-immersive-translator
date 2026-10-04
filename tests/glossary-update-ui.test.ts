import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {GlossaryUpdates} from '../src/ui/GlossaryUpdates';
import type {UpdateStatus} from '../src/glossary-update';
const {api}=vi.hoisted(()=>({api:vi.fn()}));vi.mock('../src/messaging',()=>({background:api}));
let root:Root|undefined;
const base={revision:'a',packs:[{group:'core',version:'v1',count:100},{group:'extended',version:'v1',count:200}]} as UpdateStatus['current'];
const remote={revision:'b',packs:[{group:'core',version:'v2',count:101},{group:'extended',version:'v2',count:202}]} as UpdateStatus['current'];
let state:UpdateStatus;const permission=vi.fn(),onChanged=vi.fn();
const settle=()=>new Promise<void>(r=>setTimeout(r,0));
beforeEach(()=>{
 document.body.innerHTML='';vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);state={current:base,bundled:base,canRollback:false,usingDownload:false,busy:false};permission.mockReset().mockResolvedValue(true);onChanged.mockReset().mockResolvedValue(undefined);api.mockReset().mockImplementation(async(_type,payload)=>{if(payload.command==='glossary-check')state={...state,available:remote};if(payload.command==='glossary-apply')state={...state,current:remote,available:undefined,usingDownload:true,canRollback:true};if(payload.command==='glossary-rollback')state={...state,current:base,usingDownload:false};return state;});
 vi.stubGlobal('chrome',{permissions:{request:permission},runtime:{onMessage:{addListener:()=>{},removeListener:()=>{}}}});
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;vi.unstubAllGlobals();});
async function mount(){const div=document.createElement('div');document.body.append(div);root=createRoot(div);await act(async()=>{root!.render(createElement(GlossaryUpdates,{onChanged}));await settle();});}
async function click(label:string){const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label)!;expect(button).toBeDefined();await act(async()=>{button.click();await settle();});}
it('shows an update preview and applies only after a second click, then enables rollback',async()=>{
 await mount();await click('检查词库更新');expect(permission).toHaveBeenCalledWith({origins:['https://raw.githubusercontent.com/*']});expect(document.body.textContent).toContain('可更新至 v2');expect(onChanged).not.toHaveBeenCalled();await click('更新词库');expect(api).toHaveBeenCalledWith('engine',{command:'glossary-apply',payload:{revision:'b'}});expect(onChanged).toHaveBeenCalled();expect(document.body.textContent).toContain('已下载词库');await click('回退上一版');expect(document.body.textContent).toContain('当前版本：v1');
});
it('preserves the current library when permission is refused',async()=>{permission.mockResolvedValue(false);await mount();await click('检查词库更新');expect(document.body.textContent).toContain('未授权');expect(api.mock.calls.some(c=>c[1].command==='glossary-check')).toBe(false);expect(onChanged).not.toHaveBeenCalled();});
it('reports download failures and keeps rollback available',async()=>{state={...state,usingDownload:true,canRollback:true};api.mockImplementation(async(_type,payload)=>{if(payload.command==='glossary-check')throw new Error('连接失败');return state;});await mount();await click('检查词库更新');expect(document.body.textContent).toContain('连接失败');expect([...document.querySelectorAll('button')].find(b=>b.textContent==='回退上一版')?.disabled).toBe(false);});
