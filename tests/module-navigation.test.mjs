import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { createModuleNavigation } from '../shared/navigation/navigationStore.ts';
import {sidebarGroupHasActiveChild,sidebarGroupIsExpanded} from '../shared/navigation/sidebarExpansion.ts';

function hostAt(path='/') {
  const events=new Map();
  const entries=[new URL(path,'https://faturamento.example')];
  let position=0;
  const host={
    get location(){return entries[position]},
    history:{state:{session:'preserved'},pushState(state,unused,path){
      entries.splice(position+1);entries.push(new URL(path,entries[position]));position++;
      this.state=state;
    },replaceState(state,unused,path){
      entries[position]=new URL(path,entries[position]);this.state=state;
    }},
    addEventListener(type,fn){events.set(type,fn)},
    removeEventListener(type,fn){if(events.get(type)===fn)events.delete(type)},
    back(){if(position>0)position--;events.get('popstate')?.()},
    forward(){if(position<entries.length-1)position++;events.get('popstate')?.()},
  };
  return host;
}

test('each menu destination updates the same snapshot consumed by screen and active item',()=>{
  const host=hostAt();const nav=createModuleNavigation('/',host);nav.connect();
  let selected='/',screen='/';
  nav.subscribe(()=>{selected=new URL(nav.getSnapshot(),host.location.origin).pathname});
  nav.subscribe(()=>{screen=new URL(nav.getSnapshot(),host.location.origin).pathname});
  for(const path of ['/cadastro','/solicitacoes','/cotacao','/pedidos','/contratos','/planejamento','/resumo','/agenda','/relatorios','/configuracoes','/']) {
    nav.navigate(path);
    assert.equal(screen,path);assert.equal(selected,path);assert.equal(host.location.pathname,path);
  }
  assert.deepEqual(host.history.state,{session:'preserved'});
});

test('search can change records within the same module and open a specific agenda day',()=>{
  const host=hostAt('/contratos');const nav=createModuleNavigation('/contratos',host);nav.connect();
  nav.navigate('/contratos?busca=CT-001');assert.match(nav.getSnapshot(),/CT-001/);
  nav.navigate('/contratos?busca=CT-006');assert.match(nav.getSnapshot(),/CT-006/);
  nav.navigate('/agenda?dia=2026-09-18');
  assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('dia'),'2026-09-18');
});

test('back and forward restore module and query together',()=>{
  const host=hostAt();const nav=createModuleNavigation('/',host);const disconnect=nav.connect();
  nav.navigate('/cadastro?busca=Marina');nav.navigate('/resumo');
  host.back();assert.equal(nav.getSnapshot(),'/cadastro?busca=Marina');
  host.forward();assert.equal(nav.getSnapshot(),'/resumo');
  disconnect();host.back();assert.equal(nav.getSnapshot(),'/resumo');
});

test('company list, create and edit pages participate in browser history',()=>{
  const host=hostAt('/configuracoes?secao=empresas');const nav=createModuleNavigation('/configuracoes?secao=empresas',host);nav.connect();
  nav.navigate('/configuracoes?secao=empresas&acao=nova');
  assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('acao'),'nova');
  nav.navigate('/configuracoes?secao=empresas&empresa=company-a');
  assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('empresa'),'company-a');
  host.back();assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('acao'),'nova');
  host.back();assert.equal(nav.getSnapshot(),'/configuracoes?secao=empresas');
});

test('contract detail is a deep-linked screen and successful creation replaces the modal history entry',()=>{
  const host=hostAt('/contratos');const nav=createModuleNavigation('/contratos',host);nav.connect();
  nav.navigate('/contratos?novo=1');
  nav.navigate('/contratos?contrato=contract-a',{replace:true});
  assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('contrato'),'contract-a');
  host.back();assert.equal(nav.getSnapshot(),'/contratos');
  host.forward();assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('contrato'),'contract-a');
  nav.navigate('/contratos?contrato=contract-a&editar=1');
  nav.navigate('/contratos?contrato=contract-a',{replace:true});
  assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('editar'),null);
});

test('direct route rendering and hydration retain the requested module',()=>{
  const path='/configuracoes';const host=hostAt(path);const nav=createModuleNavigation(path,host);
  assert.equal(nav.getServerSnapshot(),path);nav.connect();assert.equal(nav.getSnapshot(),path);
});

test('configuration submodules preserve deep links and browser history',()=>{
  const host=hostAt('/configuracoes?secao=perfil');const nav=createModuleNavigation('/configuracoes?secao=perfil',host);nav.connect();
  for(const section of ['usuarios','perfis-acesso','cabecalho-relatorios'])nav.navigate('/configuracoes?secao='+section);
  assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('secao'),'cabecalho-relatorios');
  host.back();assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('secao'),'perfis-acesso');
});

test('material details are deep linked and return to the filtered table',()=>{
  const list='/cadastro?secao=materiais&busca=filtro&categoria=category-a';
  const host=hostAt(list);const nav=createModuleNavigation(list,host);nav.connect();
  nav.navigate(list+'&material=material-a');
  const detail=new URL(nav.getSnapshot(),host.location.origin);
  assert.equal(detail.searchParams.get('secao'),'materiais');
  assert.equal(detail.searchParams.get('material'),'material-a');
  assert.equal(detail.searchParams.get('busca'),'filtro');
  assert.equal(detail.searchParams.get('categoria'),'category-a');
  host.back();
  assert.equal(nav.getSnapshot(),list);
});

test('purchase-order detail preserves tab, search and period in browser history',()=>{
  const list='/pedidos?aba=finalizados&busca=agrisul&de=2026-09-01&ate=2026-09-30';
  const host=hostAt(list);const nav=createModuleNavigation(list,host);nav.connect();
  nav.navigate(list+'&pedido=order-a');
  const detail=new URL(nav.getSnapshot(),host.location.origin);
  assert.equal(detail.searchParams.get('pedido'),'order-a');
  assert.equal(detail.searchParams.get('aba'),'finalizados');
  assert.equal(detail.searchParams.get('busca'),'agrisul');
  host.back();assert.equal(nav.getSnapshot(),list);
});

test('report type and month participate in navigation history',()=>{
  const host=hostAt('/relatorios');const nav=createModuleNavigation('/relatorios',host);nav.connect();
  for(const kind of ['contracts','loads','financial','farms'])nav.navigate('/relatorios?tipo='+kind+'&mes=2026-09');
  assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('tipo'),'farms');
  host.back();assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('tipo'),'financial');
  assert.equal(new URL(nav.getSnapshot(),host.location.origin).searchParams.get('mes'),'2026-09');
});

test('external URLs do not mutate module state or browser history',()=>{
  const host=hostAt('/cadastro');const nav=createModuleNavigation('/cadastro',host);
  assert.throws(()=>nav.navigate('https://other.example/contratos'),/externo/);
  assert.equal(nav.getSnapshot(),'/cadastro');assert.equal(host.location.pathname,'/cadastro');
});

test('sidebar expansion follows interaction and only locks with an active child',()=>{
  assert.equal(sidebarGroupHasActiveChild('/cadastro','/cadastro',null),true);
  assert.equal(sidebarGroupHasActiveChild('/cadastro','/',null),false);
  assert.equal(sidebarGroupHasActiveChild('/solicitacoes','/solicitacoes',null),false);
  assert.equal(sidebarGroupHasActiveChild('/solicitacoes','/solicitacoes','servico'),true);
  assert.equal(sidebarGroupHasActiveChild('/solicitacoes','/cotacao',null),true);
  assert.equal(sidebarGroupIsExpanded(false,false),false);
  assert.equal(sidebarGroupIsExpanded(false,true),true);
  assert.equal(sidebarGroupIsExpanded(true,false),true);
});

test('sidebar nests quotation and gives both grouped modules smooth hover and focus behavior',async()=>{
  const shell=await readFile(new URL('../shared/components/AppShell.tsx',import.meta.url),'utf8');
  const styles=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
  const requests=await readFile(new URL('../modules/solicitacoes/components/SolicitacoesPage.tsx',import.meta.url),'utf8');
  assert.match(shell,/solicitacoesSections=.*name:"Cotação",href:"\/cotacao"/);
  assert.match(shell,/filter\(x=>x\.path!=="\/configuracoes"&&x\.path!=="\/cotacao"\)/);
  assert.match(shell,/onMouseEnter=\{!isMobile&&grouped\?expandGroup:undefined\}/);
  assert.match(shell,/onMouseLeave=\{!isMobile&&grouped\?event=>scheduleCollapse\(event\.currentTarget\):undefined\}/);
  assert.match(shell,/onFocusCapture=\{grouped\?expandGroup:undefined\}/);
  assert.match(shell,/const groupExpanded=grouped&&sidebarGroupIsExpanded\(activeChild,!!expanded\[x\.path\]\)/);
  assert.match(shell,/className="sidebar-subnav-motion" data-open=\{groupExpanded\?"true":"false"\}/);
  assert.match(shell,/aria-hidden=\{!groupExpanded\} inert=\{!groupExpanded\}/);
  assert.match(shell,/const cadastroActive=path==="\/cadastro"/);
  assert.match(styles,/\.sidebar-subnav-motion\{[^}]*grid-template-rows:0fr[^}]*transition:grid-template-rows/);
  assert.match(styles,/\.sidebar-subnav-motion\[data-open="true"\]\{grid-template-rows:1fr;opacity:1/);
  assert.match(requests,/<ModuleLink href="\/cotacao" className="request-module-card">/);
});
