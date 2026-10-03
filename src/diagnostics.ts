export type Diagnostic={at:number;session?:string;segment?:string;stage:string;profile:string;elapsedMs:number;queueMs?:number;requestMs?:number;outputLength:number;code?:string;source?:string;response?:string};
export function errorCode(error:unknown):string{
  if(error&&typeof error==='object'&&'code' in error)return String(error.code);
  const text=error instanceof Error?error.message:String(error);
  if(/非法保护标记|未知保护标记/.test(text))return 'illegal-marker';
  if(/标记.*不完整/.test(text))return 'missing-marker';
  if(/交叉|未闭合/.test(text))return 'format-nesting';
  if(/长度上限|未完成/.test(text))return 'truncated';
  if(/预算/.test(text))return 'context-budget';
  return 'response-structure';
}
export function diagnosticRecord(value:Diagnostic,includeTexts=false):Diagnostic{
  const {source,response,...safe}=value;
  return includeTexts?{...safe,source:source?.slice(0,20000),response:response?.slice(0,20000)}:safe;
}
