type InviteOriginOptions={
 appUrl?:string;
 allowedOrigins?:string;
 vercelProject?:string;
 vercelTeam?:string;
};

const localOrigins=['http://localhost:5173','http://127.0.0.1:5173'];

function normalizeOrigin(value?:string|null){
 if(!value)return '';
 try{return new URL(value).origin;}catch{return '';}
}

export function createInviteOriginPolicy(options:InviteOriginOptions={}){
 const appOrigin=normalizeOrigin(options.appUrl)||localOrigins[0];
 const exactOrigins=new Set([appOrigin,...localOrigins,...(options.allowedOrigins??'').split(',').map(normalizeOrigin).filter(Boolean)]);
 const vercelProject=(options.vercelProject||'agrisul').trim().toLowerCase()||'agrisul';
 const vercelTeam=(options.vercelTeam||'denielson-limas-projects').trim().toLowerCase()||'denielson-limas-projects';
 const isProjectVercelOrigin=(origin:string)=>{
  try{
   const url=new URL(origin);const host=url.hostname.toLowerCase();
   if(url.protocol!=='https:')return false;
   if(host===`${vercelProject}.vercel.app`)return true;
   const teamSuffix=`-${vercelTeam}.vercel.app`;
   return host===`${vercelProject}${teamSuffix}`||host.startsWith(`${vercelProject}-`)&&host.endsWith(teamSuffix);
  }catch{return false;}
 };
 const isAllowed=(origin:string|null)=>!origin||exactOrigins.has(normalizeOrigin(origin))||isProjectVercelOrigin(origin);
 const responseOrigin=(origin:string|null)=>origin&&isAllowed(origin)?normalizeOrigin(origin):!origin?appOrigin:'';
 const headers=(origin:string|null)=>{
  const allowed=responseOrigin(origin);
  const result:Record<string,string>={
   'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
   'Access-Control-Allow-Methods':'POST, OPTIONS',
   'Vary':'Origin',
  };
  if(allowed)result['Access-Control-Allow-Origin']=allowed;
  return result;
 };
 return {appOrigin,isAllowed,headers,redirectBase:(origin:string|null)=>responseOrigin(origin)||appOrigin};
}
