import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {ChevronRight,Loader2,RefreshCw,Shovel,Sprout} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {notifications,useConfirmation} from '@/shared/feedback';
import {Choice} from '@/shared/components/Common';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {Checkbox} from '@/components/ui/checkbox';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {useCultures} from '../../culturas/hooks/useCultures';
import {usePractices} from '../hooks/usePractices';
import {managementCategories,type CulturalPractice,type ManagementCatalogEntry} from '../types';

export function TratosCulturaisPage(){
 const cultures=useCultures();
 const {user}=useAuth();
 const confirm=useConfirmation();
 const [cultureId,setCultureId]=useState('');
 const [subtypeId,setSubtypeId]=useState('');
 const [actionError,setActionError]=useState('');
 const [busyKey,setBusyKey]=useState('');
 const autoBootstrapOwner=useRef('');
 const selectedCulture=cultures.cultures.find(culture=>culture.id===cultureId);
 const selectedSubtype=selectedCulture?.subtypes.find(subtype=>subtype.id===subtypeId);
 const contextReady=!!selectedCulture&&!!selectedSubtype;
 const m=usePractices(contextReady?{cultureId,cultureSubtypeId:subtypeId}:{},contextReady);
 const runSugarcaneBootstrap=m.bootstrapSugarcane;

 useEffect(()=>{
  if(!user||cultures.loading||cultures.authRequired||cultures.error||autoBootstrapOwner.current===user.id)return;
  autoBootstrapOwner.current=user.id;setActionError('');
  void runSugarcaneBootstrap().then(result=>{
   setCultureId(result.focus.cultureId);setSubtypeId(result.focus.cultureSubtypeId);
  }).catch(caught=>{const message=(caught as Error).message;setActionError(message);notifications.error(message);});
 },[cultures.authRequired,cultures.error,cultures.loading,runSugarcaneBootstrap,user]);

 const changeCulture=(value:string)=>{setCultureId(value);setSubtypeId('');setActionError('');};
 const retryBootstrap=async()=>{
  setActionError('');
  try{const result=await m.bootstrapSugarcane();setCultureId(result.focus.cultureId);setSubtypeId(result.focus.cultureSubtypeId);}
  catch(caught){const message=(caught as Error).message;setActionError(message);notifications.error(message);}
 };
 const toggleAssignment=async(catalog:ManagementCatalogEntry,practice?:CulturalPractice)=>{
  if(!selectedCulture||!selectedSubtype||busyKey)return;
  if(practice){
   const accepted=await confirm({title:`Remover “${catalog.name}”?`,description:`O processo deixará de estar vinculado a ${selectedCulture.name} · ${selectedSubtype.name}.${practice.description?' A observação cadastrada também será removida.':''}`,confirmLabel:'Remover vínculo',tone:'destructive'});
   if(!accepted)return;
  }
  const key=`${catalog.category}:${catalog.name}`;setBusyKey(key);setActionError('');
  try{
   if(practice){await m.remove(practice.id);notifications.deleted(`“${catalog.name}” foi removido deste ciclo.`);}
   else{await m.save({cultureId,cultureSubtypeId:subtypeId,category:catalog.category,name:catalog.name,description:''});notifications.created(`“${catalog.name}” foi vinculado a ${selectedCulture.name} · ${selectedSubtype.name}.`);}
  }catch(caught){const message=(caught as Error).message;setActionError(message);notifications.error(message);}
  finally{setBusyKey('');}
 };

 return <section>
  <nav className="client-breadcrumb farm-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><ChevronRight size={13}/><span aria-current="page">Manejo</span></nav>
  <div className="companies-heading"><div><h2>Manejo</h2><p>Escolha a cultura e o ciclo; depois marque os processos utilizados.</p></div></div>
  {actionError&&<div className="management-action-error" role="alert"><span>{actionError}</span><button className="btn" onClick={()=>void retryBootstrap()} disabled={m.bootstrapping}><RefreshCw size={15}/>Tentar novamente</button></div>}
  {!cultures.loading&&!cultures.authRequired&&!cultures.error&&!!cultures.cultures.length&&<div className="management-context" aria-label="Contexto do manejo"><div><span>Cultura</span><Choice label="Selecione a cultura" value={cultureId} onChange={changeCulture} items={cultures.cultures.map(culture=>({value:culture.id,label:culture.name}))}/></div><div><span>Ciclo da cultura</span><Choice label={cultureId?'Selecione planta, soca ou outro ciclo':'Selecione primeiro a cultura'} value={subtypeId} onChange={value=>{setSubtypeId(value);setActionError('');}} disabled={!cultureId} items={(selectedCulture?.subtypes??[]).map(subtype=>({value:subtype.id,label:subtype.name}))}/></div></div>}
  {cultures.loading||m.bootstrapping?<div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>{m.bootstrapping?'Preparando processos padrão…':'Carregando culturas…'}</div>:cultures.authRequired?<div className="company-empty"><span className="company-empty-icon"><Shovel size={25}/></span><h3>Acesse seus manejos</h3><p>Entre para consultar e configurar os processos das culturas.</p><Link className="btn company-primary" href="/login?returnTo=%2Fcadastro%3Fsecao%3Dtratos-culturais" target="_top">Entrar</Link></div>:cultures.error?<div className="company-empty" role="alert"><h3>Não foi possível carregar</h3><p>{cultures.error}</p><button className="btn" onClick={cultures.reload}><RefreshCw size={16}/>Tentar novamente</button></div>:!cultures.cultures.length?<div className="company-empty"><span className="company-empty-icon"><Sprout size={25}/></span><h3>Cadastre uma cultura primeiro</h3><p>Os processos serão associados à cultura e ao ciclo escolhidos.</p><ModuleLink className="btn company-primary" href="/cadastro?secao=culturas">Ir para Culturas</ModuleLink></div>:!cultureId?<div className="company-empty"><span className="company-empty-icon"><Sprout size={25}/></span><h3>Selecione a cultura</h3><p>Escolha a cultura que receberá os processos de manejo.</p></div>:!selectedCulture?.subtypes.length?<div className="company-empty"><span className="company-empty-icon"><Sprout size={25}/></span><h3>Cadastre um ciclo</h3><p>A cultura {selectedCulture?.name} ainda não possui ciclos cadastrados.</p><ModuleLink className="btn company-primary" href={'/cadastro?secao=culturas&cultura='+encodeURIComponent(cultureId)}>Cadastrar ciclo</ModuleLink></div>:!subtypeId?<div className="company-empty"><span className="company-empty-icon"><Shovel size={25}/></span><h3>Selecione o ciclo da cultura</h3><p>Escolha, por exemplo, {selectedCulture.subtypes.slice(0,2).map(item=>item.name).join(' ou ')}.</p></div>:m.loading?<div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando processos…</div>:m.error?<div className="company-empty" role="alert"><h3>Não foi possível carregar</h3><p>{m.error}</p><button className="btn" onClick={m.reload}><RefreshCw size={16}/>Tentar novamente</button></div>:<ManagementTabs catalog={m.catalog} practices={m.practices} context={`${selectedCulture.name} · ${selectedSubtype!.name}`} busyKey={busyKey} onToggle={toggleAssignment}/>} 
 </section>;
}

function ManagementTabs({catalog,practices,context,busyKey,onToggle}:{catalog:ManagementCatalogEntry[];practices:CulturalPractice[];context:string;busyKey:string;onToggle:(catalog:ManagementCatalogEntry,practice?:CulturalPractice)=>Promise<void>}){
 return <><p className="farm-count">Processos utilizados em {context}</p><Tabs defaultValue="soil-preparation" className="management-tabs"><TabsList variant="line" aria-label="Categoria de manejo">{managementCategories.map(category=>{const available=catalog.filter(item=>item.category===category.value);const selected=practices.filter(item=>item.category===category.value).length;return <TabsTrigger value={category.value} key={category.value}>{category.label}<span>{selected}/{available.length}</span></TabsTrigger>;})}</TabsList>{managementCategories.map(category=>{const operations=catalog.filter(item=>item.category===category.value);return <TabsContent value={category.value} key={category.value}><div className="management-process-list">{operations.map(operation=>{const practice=practices.find(item=>item.category===operation.category&&item.name===operation.name);const key=`${operation.category}:${operation.name}`;const busy=busyKey===key;return <label className={'management-process '+(practice?'selected':'')} key={key}><span className="management-process-check"><Checkbox checked={!!practice} disabled={!!busyKey} aria-label={`${practice?'Remover':'Vincular'} ${operation.name} em ${context}`} onCheckedChange={checked=>{if((checked===true&&!practice)||(checked===false&&practice))void onToggle(operation,practice);}}/>{busy&&<Loader2 size={14} className="animate-spin"/>}</span><span><strong>{operation.name}</strong><small>{practice?'Utilizado neste ciclo':'Não utilizado neste ciclo'}</small>{practice?.description&&<em>{practice.description}</em>}</span></label>;})}</div></TabsContent>;})}</Tabs></>;
}
