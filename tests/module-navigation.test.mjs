import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleNavigation } from '../shared/navigation/navigationStore.ts';

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
  for(const path of ['/cadastro','/contratos','/planejamento','/resumo','/agenda','/relatorios','/configuracoes','/']) {
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
