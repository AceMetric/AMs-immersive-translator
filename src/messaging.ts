export async function background(type:string,payload:Record<string,unknown>={}){
  const response=await chrome.runtime.sendMessage({target:'background',type,...payload});
  if(response?.error)throw new Error(response.error);return response?.result;
}
