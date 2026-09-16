import Link from 'next/link';
import {useMemo,useState} from 'react';
import {ChevronRight,FileDown,Loader2,Plus,RefreshCw,Search,Tractor} from 'lucide-react';
import {ModuleLink,useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {notifications} from '@/shared/feedback';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useFarms} from '../hooks/useFarms';
import {FarmForm} from '../forms/FarmForm';
import {FarmCard} from './FarmCard';
import {FarmReportDialog} from './FarmReportDialog';
import {FarmPlotsPage} from '../../talhoes/components/FarmPlotsPage';
import type {Farm} from '../types';

export function FazendaPage(){
 const {searchParams}=useModuleNavigation();const farmId=searchParams.get('fazenda');
 return farmId?<FarmPlotsPage key={farmId} farmId={farmId}/>:<FarmListPage/>;
}

function FarmListPage(){
  const m=useFarms();const {navigate}=useModuleNavigation();const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [edit,setEdit]=useState<Farm>();const [reportOpen,setReportOpen]=useState(false);const [search,setSearch]=useState('');const [city,setCity]=useState('');const [state,setState]=useState('');
  const begin=(farm?:Farm)=>{setEdit(farm);setBusy(false);setOpen(true);};
  const cities=useMemo(()=>[...new Set(m.farms.map(farm=>farm.city))].sort((a,b)=>a.localeCompare(b,'pt-BR')),[m.farms]);
  const states=useMemo(()=>[...new Set(m.farms.map(farm=>farm.state))].sort(),[m.farms]);
  const filtered=useMemo(()=>{const term=search.trim().toLocaleLowerCase('pt-BR');return m.farms.filter(farm=>(!term||`${farm.name} ${farm.city} ${farm.state}`.toLocaleLowerCase('pt-BR').includes(term))&&(!city||farm.city===city)&&(!state||farm.state===state));},[m.farms,search,city,state]);
  const clearFilters=()=>{setSearch('');setCity('');setState('');};
  return <section className="farms-workspace"><nav className="client-breadcrumb farm-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><ChevronRight size={13}/><span aria-current="page">Fazenda</span></nav><div className="companies-heading"><div><h2>Fazendas e talhões</h2><p>Abra uma fazenda para organizar os talhões e acompanhe a distribuição das áreas.</p></div>{!m.authRequired&&<div className="farm-heading-actions"><button className="btn" disabled={m.loading||!!m.error||!m.farms.length} onClick={()=>setReportOpen(true)}><FileDown size={17}/>Exportar PDF</button><button className="btn company-primary" disabled={m.loading||!!m.error} onClick={()=>begin()}><Plus size={17}/>Cadastrar fazenda</button></div>}</div>
    {!m.loading&&!m.authRequired&&!m.error&&!!m.farms.length&&<div className="farm-toolbar"><label className="local-search"><Search size={16}/><span className="sr-only">Buscar fazenda</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar por fazenda, cidade ou UF…"/></label><label><span className="sr-only">Filtrar por cidade</span><select className="choice" value={city} onChange={event=>setCity(event.target.value)}><option value="">Todas as cidades</option>{cities.map(value=><option value={value} key={value}>{value}</option>)}</select></label><label><span className="sr-only">Filtrar por UF</span><select className="choice farm-state-filter" value={state} onChange={event=>setState(event.target.value)}><option value="">Todas as UFs</option>{states.map(value=><option value={value} key={value}>{value}</option>)}</select></label><span>{filtered.length} de {m.farms.length}</span></div>}
    {m.loading?<div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando fazendas…</div>:m.authRequired?<div className="company-empty"><span className="company-empty-icon"><Tractor size={25}/></span><h3>Acesse suas fazendas</h3><p>Entre para consultar e salvar suas propriedades.</p><Link className="btn company-primary" href="/login?returnTo=%2Fcadastro%3Fsecao%3Dfazenda" target="_top">Entrar</Link></div>:m.error?<div className="company-empty" role="alert"><h3>Não foi possível carregar</h3><p>{m.error}</p><button className="btn" onClick={m.reload}><RefreshCw size={16}/>Tentar novamente</button></div>:!m.farms.length?<div className="company-empty"><span className="company-empty-icon"><Tractor size={25}/></span><h3>Cadastre sua primeira fazenda</h3><p>Informe o nome, a área em hectares, a cidade e a UF.</p><button className="btn company-primary" onClick={()=>begin()}><Plus size={16}/>Cadastrar fazenda</button></div>:!filtered.length?<div className="company-empty"><span className="company-empty-icon"><Search size={25}/></span><h3>Nenhuma fazenda encontrada</h3><p>Ajuste a busca ou remova os filtros de cidade e UF.</p><button className="btn" onClick={clearFilters}>Limpar filtros</button></div>:<><p className="farm-count">{filtered.length} fazenda{filtered.length!==1?'s':''} encontrada{filtered.length!==1?'s':''}</p><div className="farm-grid">{filtered.map(farm=><FarmCard key={farm.id} farm={farm} onOpen={()=>navigate('/cadastro?secao=fazenda&fazenda='+encodeURIComponent(farm.id))} onEdit={()=>begin(farm)}/>)}</div></>}
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="form-modal farm-modal" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}><DialogHeader><DialogTitle>{edit?'Editar fazenda':'Cadastrar fazenda'}</DialogTitle><DialogDescription>Preencha os dados da propriedade.</DialogDescription></DialogHeader><FarmForm farm={edit} onBusy={setBusy} onClose={()=>{setBusy(false);setOpen(false);}} onSave={async(input,id)=>{await m.save(input,id);if(id)notifications.updated('A fazenda foi atualizada.');else notifications.created('A fazenda foi cadastrada.');}}/></DialogContent></Dialog>
    {reportOpen&&m.summary&&<FarmReportDialog open={reportOpen} onOpenChange={setReportOpen} farms={m.farms} summary={m.summary}/>} 
  </section>;
}
