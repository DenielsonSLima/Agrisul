import {createClient} from 'npm:@supabase/supabase-js@2.115.0';

type InviteBody={email?:unknown;accessProfileId?:unknown;requestId?:unknown};
const supabaseUrl=Deno.env.get('SUPABASE_URL')??'';
const anonKey=Deno.env.get('SUPABASE_ANON_KEY')??'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const appUrl=(Deno.env.get('APP_URL')??'http://localhost:5173').replace(/\/$/,'');

function cors(origin:string|null){
 const allowed=origin===appUrl?origin:appUrl;
 return {'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
}
function reply(origin:string|null,status:number,body:Record<string,unknown>){
 return new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
function publicInviteError(message:string){
 if(/already|registered|exists/i.test(message))return 'Este e-mail já possui uma conta e não pode receber um novo convite.';
 if(/rate|limit/i.test(message))return 'O limite temporário de e-mails foi atingido. Tente novamente mais tarde.';
 if(/authorized|smtp|email address/i.test(message))return 'O servidor de e-mail ainda não está configurado para enviar a este endereço.';
 return 'Não foi possível enviar o convite. Tente novamente.';
}

Deno.serve(async request=>{
 const origin=request.headers.get('Origin');
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});
 if(request.method!=='POST')return reply(origin,405,{error:'Método não permitido.'});
 if(!supabaseUrl||!anonKey||!serviceKey)return reply(origin,503,{error:'O serviço de convites não está configurado.'});
 const authorization=request.headers.get('Authorization');
 if(!authorization?.startsWith('Bearer '))return reply(origin,401,{error:'Entre novamente para enviar o convite.'});
 let body:InviteBody;
 try{body=await request.json();}catch{return reply(origin,400,{error:'Dados do convite inválidos.'});}
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 const accessProfileId=typeof body.accessProfileId==='string'?body.accessProfileId:'';
 const requestId=typeof body.requestId==='string'&&body.requestId?body.requestId:crypto.randomUUID();
 if(!email||!accessProfileId)return reply(origin,400,{error:'Informe o e-mail e o perfil de acesso.'});
 const caller=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {error:userError}=await caller.auth.getUser(authorization.slice(7));
 if(userError)return reply(origin,401,{error:'Sua sessão expirou. Entre novamente.'});
 const {data:prepared,error:prepareError}=await caller.rpc('billing_rpc',{p_resource:'users',p_action:'prepare-invite',p_payload:{email,accessProfileId,requestId}});
 if(prepareError)return reply(origin,prepareError.code==='42501'?403:prepareError.code==='23505'?409:400,{error:prepareError.message});
 const invitationId=String(prepared?.invitationId??prepared?.user?.id??'');
 const attemptId=crypto.randomUUID();
 const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data:invited,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{
  redirectTo:`${appUrl}/auth/confirm`,
  data:{billing_invitation_id:invitationId,onboarding_required:true},
 });
 if(inviteError){
  await caller.rpc('billing_rpc',{p_resource:'users',p_action:'finalize-invite',p_payload:{invitationId,attemptId,outcome:'failed',error:inviteError.code??inviteError.message}});
  return reply(origin,inviteError.status===429?429:502,{error:publicInviteError(`${inviteError.code??''} ${inviteError.message}`)});
 }
 const authUserId=invited.user?.id;
 const {data:finalized,error:finalizeError}=await caller.rpc('billing_rpc',{p_resource:'users',p_action:'finalize-invite',p_payload:{invitationId,attemptId,outcome:'sent',authUserId}});
 if(finalizeError)return reply(origin,500,{error:'O e-mail foi enviado, mas o registro do convite precisa ser conferido antes de reenviar.'});
 return reply(origin,200,{user:finalized?.user??prepared?.user});
});
