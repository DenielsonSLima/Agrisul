// Provision only this project's scoped scheduler secret. Values never enter
// the repository, command output, frontend environment or committed migrations.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const ref='ykounjabfsrtkzostbbz',cli='.sites-runtime/tools/supabase.exe';
assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref);
const invoke=args=>{
 try{return JSON.parse(execFileSync(cli,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
 catch{throw Error('Não foi possível concluir a operação no agrisul pelo CLI autenticado.');}
};
const projects=invoke(['projects','list']);
assert.ok(projects.projects.some(project=>project.ref===ref&&project.linked));
const query=sql=>invoke(['db','query','--linked','--project-ref',ref,sql]).rows;
let token=query("SELECT decrypted_secret AS token FROM vault.decrypted_secrets WHERE name='dashboard_market_refresh_token'")[0]?.token;
if(!token){
 token=randomBytes(32).toString('hex');
 query(`SELECT vault.create_secret('${token}','dashboard_market_refresh_token','Scoped Dashboard market scheduler token') IS NOT NULL AS created`);
}
if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('O segredo de coleta existente não tem o formato esperado.');
const directory=mkdtempSync(join(tmpdir(),'billing-market-secret-')),path=join(directory,'worker.env');
try{
 writeFileSync(path,`DASHBOARD_MARKET_REFRESH_TOKEN=${token}\n`,{mode:0o600});
 try{execFileSync(cli,['secrets','set','--project-ref',ref,'--env-file',path],{stdio:['ignore','pipe','pipe']});}
 catch{throw Error('Não foi possível configurar o segredo da função coletora.');}
}finally{unlinkSync(path);rmdirSync(directory);}
console.log('Scoped refresh token configured in Vault and Edge secrets.');
for(const group of ['currency','cane','agriculture']){
 const response=await fetch(`https://${ref}.supabase.co/functions/v1/dashboard-market-refresh`,{method:'POST',headers:{'Content-Type':'application/json','x-market-refresh-token':token},body:JSON.stringify({group}),signal:AbortSignal.timeout(100000)});
 const body=await response.json();console.log(JSON.stringify({group,status:response.status,...body}));
 if(!response.ok)process.exitCode=1;
}
