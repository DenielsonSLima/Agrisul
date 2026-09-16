import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const PROJECT_REF = 'rbuscpwntzpyqsuycqmv';
export function getMcpCredentials() {
 const configPath=process.env.BILLING_MCP_CONFIG || `${process.env.HOME}/.gemini/antigravity/mcp_config.json`;
 const config=JSON.parse(readFileSync(configPath,'utf8'));
 const server=config.mcpServers?.['supabase-controle-faturamento'];
 if(!server || new URL(server.serverUrl).searchParams.get('project_ref')!==PROJECT_REF) throw new Error('MCP do Controle de Faturamento não está configurado para o projeto esperado.');
 return {url:server.serverUrl,authorization:server.headers.Authorization};
}
export async function callMcp(name,args={}) {
 const {url,authorization}=getMcpCredentials();
 const headers={Authorization:authorization,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 let id=0;
 async function rpc(method,params,notification=false){
  const requestId=++id;
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:requestId}),method,params}),signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw new Error(`Supabase MCP: HTTP ${response.status}`);
  const sid=response.headers.get('mcp-session-id');if(sid)headers['mcp-session-id']=sid;
  if(notification)return;
  const raw=await response.text();let result;
  try{result=JSON.parse(raw)}catch{result=raw.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))).find(d=>d.id===requestId)}
  if(result?.error)throw new Error(`Supabase MCP ${method}: ${JSON.stringify(result.error)}`);
  return result?.result;
 }
 await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'controle-faturamento-operations',version:'1.0'}});
 await rpc('notifications/initialized',{},true);
 const result=await rpc('tools/call',{name,arguments:args});
 if(result?.isError)throw new Error(JSON.stringify(result.content));
 return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 const [name,file]=process.argv.slice(2);
 if(!name)throw new Error('Uso: node scripts/supabase-mcp.mjs TOOL [args.json]');
 const args=file?JSON.parse(readFileSync(file,'utf8')):{};
 console.log(JSON.stringify(await callMcp(name,args)));
}
