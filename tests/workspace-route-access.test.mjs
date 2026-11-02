import test from 'node:test';
import assert from 'node:assert/strict';
import {canOpenWorkspaceHref,workspaceLandingHref,hasWorkspacePermission,cadastroPermissions,requestPermissions,configurationPermissions} from '../shared/access/routeAccess.ts';
const limited={isOwner:false,permissions:['employees.read','employees.write','overtime.read','overtime.write']};
test('employee and overtime profile opens only its business submodules, including direct links',()=>{
 for(const href of ['/cadastro','/cadastro?secao=funcionarios','/solicitacoes','/solicitacoes?secao=horas-extras&relatorio=record'])assert.equal(canOpenWorkspaceHref(limited,href),true,href);
 for(const section of Object.keys(cadastroPermissions).filter(section=>section!=='funcionarios'))assert.equal(canOpenWorkspaceHref(limited,'/cadastro?secao='+section),false,section);
 for(const section of Object.keys(requestPermissions).filter(section=>section!=='horas-extras'))assert.equal(canOpenWorkspaceHref(limited,'/solicitacoes?secao='+section),false,section);
 for(const href of ['/','/dashboard','/cotacao','/pedidos','/contratos','/documentacao','/importacoes','/agenda','/relatorios','/configuracoes',...Object.keys(configurationPermissions).map(section=>'/configuracoes?secao='+section)])assert.equal(canOpenWorkspaceHref(limited,href),false,href);
 assert.equal(workspaceLandingHref(limited),'/cadastro?secao=funcionarios');
 assert.equal(canOpenWorkspaceHref(limited,'/configuracoes?secao=perfil'),true,'personal account settings do not confer administration');
});
test('unknown and absent access fails closed; owners can open every registered section',()=>{
 for(const actor of [undefined,{isOwner:false,permissions:[]}]){
  assert.equal(canOpenWorkspaceHref(actor,'/cadastro?secao=funcionarios'),false);
  assert.equal(workspaceLandingHref(actor),null);
 }
 const owner={isOwner:true,permissions:[]};
 for(const [prefix,sections] of [['/cadastro',cadastroPermissions],['/solicitacoes',requestPermissions],['/configuracoes',configurationPermissions]])for(const section of Object.keys(sections))assert.equal(canOpenWorkspaceHref(owner,prefix+'?secao='+section),true);
 assert.equal(workspaceLandingHref(owner),'/');
 assert.equal(canOpenWorkspaceHref(owner,'/cadastro?secao=not-a-module'),false);
 assert.equal(canOpenWorkspaceHref(owner,'/unknown'),false);
});
test('consultation and administration stay separate, while signatures manage includes consultation',()=>{
 const reader={isOwner:false,permissions:['employees.read']};
 assert.equal(canOpenWorkspaceHref(reader,'/cadastro?secao=funcionarios'),true);
 assert.equal(hasWorkspacePermission(reader,'employees.write'),false);
 for(const permission of ['signatures.read','signatures.manage'])assert.equal(canOpenWorkspaceHref({isOwner:false,permissions:[permission]},'/cadastro?secao=assinaturas'),true);
 assert.equal(canOpenWorkspaceHref({isOwner:false,permissions:['companies.read']},'/configuracoes'),true);
 assert.equal(canOpenWorkspaceHref({isOwner:false,permissions:['users.manage']},'/configuracoes?secao=empresas'),false);
});
