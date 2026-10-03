import EngineWorker from '../../src/engine.worker?worker';
const worker=new EngineWorker();
const pending=new Map<string,(response:unknown)=>void>();
worker.onmessage=({data})=>{if(data.event){void chrome.runtime.sendMessage({target:'background',type:'engine-event',event:data.event}).catch(()=>{});}else{pending.get(data.requestId)?.(data.error?{error:data.error}:{result:data.result});pending.delete(data.requestId);}};
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message.target!=='offscreen')return;
  const requestId=crypto.randomUUID();pending.set(requestId,respond);worker.postMessage({requestId,type:message.type,payload:message.payload});return true;
});
