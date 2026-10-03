import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
const base=process.env.AM_OLLAMA_URL??'http://localhost:11434';
const tags=await fetch(base+'/api/tags').then(r=>r.json());
const model=process.env.AM_OLLAMA_MODEL??tags.models[0]?.name;
if(!model)throw new Error('Ollama 中没有已安装模型。');
const prompt=readFileSync('src/protocol.ts','utf8').match(/export const systemPrompt = `([\s\S]*?)`;/)[1];
const samples=[
 {domain:'math',segments:[{id:'m1',text:'A ⟪AM:T:0⟫ has a ⟪AM:T:1⟫ and a dimension. Let ⟪AM:P:0⟫ be a basis vector.'},{id:'m2',text:'The same ⟪AM:T:0⟫ is defined over a ⟪AM:T:2⟫. The command ⟪AM:P:1⟫ checks this theorem.'}],terminology:[{token:'⟪AM:T:0⟫',source:'vector space',target:'向量空间'},{token:'⟪AM:T:1⟫',source:'basis',target:'基'},{token:'⟪AM:T:2⟫',source:'field',target:'域'}]},
 {domain:'physics',segments:[{id:'p1',text:'The ⟪AM:T:0⟫ determines the energy of a quantum state in the electromagnetic ⟪AM:T:1⟫. The formula is ⟪AM:P:0⟫.'}],terminology:[{token:'⟪AM:T:0⟫',source:'Hamiltonian',target:'哈密顿量'},{token:'⟪AM:T:1⟫',source:'field',target:'场'}]},
 {domain:'cs',segments:[{id:'c1',text:'Each database record contains a ⟪AM:T:0⟫. The ⟪AM:T:1⟫ detects this value while preserving the code ⟪AM:P:0⟫.'}],terminology:[{token:'⟪AM:T:0⟫',source:'field',target:'字段'},{token:'⟪AM:T:1⟫',source:'compiler',target:'编译器'}]},
];
const native=process.env.AM_OLLAMA_NATIVE==='1';
const precise=process.env.AM_OLLAMA_QUALITY==='precise';
const report={quality:precise?'precise':'fast',model,url:base,native,date:new Date().toISOString(),samples:[]};
for(const sample of samples.filter(s=>!process.env.AM_OLLAMA_DOMAIN||s.domain===process.env.AM_OLLAMA_DOMAIN)){
 const started=performance.now();
 const response=await fetch(base+(native?'/api/chat':'/v1/chat/completions'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify({target:'zh-CN',mode:'academic',context:{title:'Academic translation validation'},...sample})}],stream:false,max_tokens:1200,temperature:0,think:precise,...(native?{options:{num_ctx:4096,num_predict:precise?4096:1200,temperature:0}}:{})}),signal:AbortSignal.timeout(180000)});
 if(!response.ok)throw new Error('Ollama HTTP '+response.status);
 const data=await response.json();let raw=data.message?.content??data.choices?.[0]?.message?.content??'';
 raw=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
 const parsed=JSON.parse(raw);const results=Array.isArray(parsed)?parsed:parsed.translations;
 let valid=Array.isArray(results)&&results.length===sample.segments.length;
 for(const segment of sample.segments){const result=results?.find(x=>x.id===segment.id);const a=(segment.text.match(/⟪AM:[^⟫]+⟫/g)??[]).sort();const b=(result?.text?.match(/⟪AM:[^⟫]+⟫/g)??[]).sort();valid&&=JSON.stringify(a)===JSON.stringify(b)&&/[\u4e00-\u9fff]/.test(result?.text??'');}
 const row={domain:sample.domain,durationMs:Math.round(performance.now()-started),valid,translations:results,usage:data.usage??{prompt_tokens:data.prompt_eval_count,completion_tokens:data.eval_count}};report.samples.push(row);console.log(JSON.stringify(row));
 if(!valid)throw new Error('Qwen returned malformed protection markers.');
}
mkdirSync('artifacts',{recursive:true});writeFileSync(precise?'artifacts/ollama-precise-report.json':native?'artifacts/ollama-native-report.json':'artifacts/ollama-live-report.json',JSON.stringify(report,null,2));
