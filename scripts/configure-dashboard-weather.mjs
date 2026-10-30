// Provision this project's scheduled worker token without exposing it to clients.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const ref='ykounjabfsrtkzostbbz',cli='.sites-runtime/tools/supabase.exe';
assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref);
const invoke=args=>{try{return JSON.parse(execFileSync(cli,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch{throw Error('Não foi possível configurar a coleta de clima no agrisul.');}};
assert.ok(invoke(['projects','list']).projects.some(project=>project.ref===ref&&project.linked));
const query=sql=>invoke(['db','query','--linked','--project-ref',ref,sql]).rows;
let token=query("SELECT decrypted_secret AS token FROM vault.decrypted_secrets WHERE name='dashboard_weather_refresh_token'")[0]?.token;
if(!token){token=randomBytes(32).toString('hex');query(`SELECT vault.create_secret('${token}','dashboard_weather_refresh_token','Scoped weather collector token') IS NOT NULL AS created`);}
if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('Segredo da coleta de clima inválido.');
const directory=mkdtempSync(join(tmpdir(),'billing-weather-secret-')),path=join(directory,'worker.env');
try{writeFileSync(path,`DASHBOARD_WEATHER_REFRESH_TOKEN=${token}\n`,{mode:0o600});try{execFileSync(cli,['secrets','set','--project-ref',ref,'--env-file',path],{stdio:['ignore','pipe','pipe']});}catch{throw Error('Falha ao configurar o segredo da coleta.');}}
finally{unlinkSync(path);rmdirSync(directory);}
console.log('Scoped weather worker secret configured in Vault and Edge.');
const response=await fetch(`https://${ref}.supabase.co/functions/v1/dashboard-weather-refresh`,{method:'POST',headers:{'Content-Type':'application/json','x-weather-refresh-token':token},body:'{}',signal:AbortSignal.timeout(100000)});
if(!response.ok)throw Error('A coleta de clima ainda não respondeu corretamente.');
const body=await response.json();console.log(JSON.stringify({status:response.status,...body}));
