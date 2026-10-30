'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowLeft,ArrowRight,CheckCircle2,ChevronRight,Clock3,Download,Filter,FolderOpen,Loader2,Pencil,Plus,RefreshCw,Search,Trash2,Users} from 'lucide-react';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Field} from '@/shared/components/Common';
import {notifications,useConfirmation} from '@/shared/feedback';
import {ModuleLink,useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {assertSessionActor} from '@/shared/supabase/sessionActor';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {useReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/hooks/useReportHeader';
import {dateLabel} from '@/shared/utils/presentation';
import {useOvertimeList,useOvertimeMutations,useOvertimeOptions,useOvertimeReport} from '../hooks/useOvertime';
import {fetchOvertimeReport} from '../services/overtimeApi';
import type {OvertimeCreateInput,OvertimeFilters,OvertimeInput,OvertimeReport,OvertimeSummary} from '../types';
import {OvertimeCreateModal} from './OvertimeCreateModal';
import {OvertimeForm} from './OvertimeForm';
import {OvertimeSheet} from './OvertimeSheet';
import '../styles.css';

export function OvertimePage(){
 const {user}=useAuth(),workspace=useWorkspaceCompany();
 if(workspace.loading)return <Loading/>;
 if(workspace.error)return <ErrorState error={workspace.error} onRetry={()=>void workspace.reload()}/>;
 if(!workspace.activeCompanyId)return <div className="company-empty"><h3>Cadastre uma empresa para criar os relatórios</h3><ModuleLink className="btn" href="/configuracoes?secao=empresas">Abrir empresas</ModuleLink></div>;
 return <OvertimeWorkspace key={(user?.id??'')+':'+workspace.activeCompanyId} companyId={workspace.activeCompanyId} companyName={workspace.activeCompany?.name??''}/>;
}
function OvertimeWorkspace({companyId,companyName}:{companyId:string;companyName:string}){
 const {user}=useAuth(),{searchParams,navigate}=useModuleNavigation(),confirm=useConfirmation();
 const id=searchParams.get('relatorio')??'',creating=searchParams.get('novo')==='1'&&!id,editing=searchParams.get('editar')==='1'&&!!id;
 const dateFrom=searchParams.get('de')??'',dateTo=searchParams.get('ate')??'',search=searchParams.get('busca')??'';
 const status=searchParams.get('aba')==='finalizados'?'finished':'open';
 const filters:OvertimeFilters={companyId,status,search,...(dateFrom&&dateTo?{dateFrom,dateTo}:{})};
 const list=useOvertimeList(filters),options=useOvertimeOptions(companyId),detail=useOvertimeReport(companyId,id),mutations=useOvertimeMutations();
 const header=useReportHeader(companyId,'landscape');
 const [formError,setFormError]=useState(''),[createError,setCreateError]=useState(''),[exportError,setExportError]=useState(''),[exporting,setExporting]=useState(false);
 const [draftStatus,setDraftStatus]=useState<'saved'|'saving'|'error'>('saved');
 const mounted=useRef(false),exportController=useRef<AbortController|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;exportController.current?.abort();};},[]);
 const href=(target?:string,edit=false,tab=status,query=search,from=dateFrom,to=dateTo)=>{
  const params=new URLSearchParams({secao:'horas-extras'});if(tab==='finished')params.set('aba','finalizados');
  if(query)params.set('busca',query);if(from&&to){params.set('de',from);params.set('ate',to);}
  if(target)params.set('relatorio',target);if(edit)params.set('editar','1');return '/solicitacoes?'+params;
 };
 const canManage=options.data?.canManage??false,busy=mutations.saving||mutations.deleting||mutations.finishing||mutations.reopening;
 const report=detail.data,isOpen=report?.status==='open';
 const create=async(input:OvertimeCreateInput)=>{
  setCreateError('');
  try{const result=await mutations.create(input);if(!mounted.current)return;notifications.created('O período foi criado. Inclua os funcionários e as horas extras.');navigate(href(result.report.id,true));}
  catch(error){if(!mounted.current)return;const message=error instanceof Error?error.message:'Não foi possível criar o relatório.';setCreateError(message);notifications.error(message);}
 };
 const save=async(input:OvertimeInput):Promise<OvertimeReport>=>{
  setFormError('');
  try{const result=await mutations.save(input);if(mounted.current)notifications.saved('As alterações do relatório foram salvas.');return result.report;}
  catch(error){if(mounted.current){const message=error instanceof Error?error.message:'Não foi possível salvar o relatório.';setFormError(message);notifications.error(message);}throw error;}
 };
 const remove=async(item:OvertimeSummary)=>{
  if(!await confirm({title:'Excluir relatório de hora extra?',description:'O relatório de '+dateLabel(item.dateFrom)+' a '+dateLabel(item.dateTo)+' e suas linhas de funcionários serão excluídos.',confirmLabel:'Excluir relatório',tone:'destructive'}))return;
  try{await mutations.remove({companyId,id:item.id,expectedUpdatedAt:item.updatedAt});if(!mounted.current)return;notifications.deleted('O relatório de hora extra foi excluído.');navigate(href());}
  catch(error){if(mounted.current)notifications.error(error instanceof Error?error.message:'Não foi possível excluir o relatório.');}
 };
 const finish=async()=>{
  if(!report)return;
  if(!await confirm({title:'Finalizar relatório?',description:'O relatório será movido para Finalizados e ficará disponível para consulta e exportação. As horas não poderão mais ser editadas.',confirmLabel:'Finalizar relatório'}))return;
  try{await mutations.finish({companyId,id:report.id,expectedUpdatedAt:report.updatedAt});if(!mounted.current)return;notifications.updated('O relatório foi finalizado.');navigate(href(undefined,false,'finished'));}
  catch(error){if(mounted.current)notifications.error(error instanceof Error?error.message:'Não foi possível finalizar o relatório.');}
 };
 const exportPdf=async()=>{
  if(exporting||!user||!id||draftStatus==='saving'||draftStatus==='error')return;
  const actorId=user.id,controller=new AbortController();exportController.current=controller;setExporting(true);setExportError('');
  try{
   if(header.loading||header.error)throw Error(header.error||'Aguarde o carregamento da identidade do relatório.');
   await assertSessionActor(actorId);
   const [snapshot,watermark,{createOvertimePdf}]=await Promise.all([fetchOvertimeReport(companyId,id,controller.signal),header.refreshWatermark(),import('../reporting/overtimePdf')]);
   const result=await createOvertimePdf(snapshot,{header:header.settings.landscape,company:header.company,watermark,issuer:header.issuer,issuedAt:new Date()});
   await assertSessionActor(actorId);if(!mounted.current||controller.signal.aborted)return;result.doc.save(result.fileName);
  }catch(error){if(mounted.current){const message=error instanceof Error?error.message:'Não foi possível gerar o PDF.';setExportError(message);notifications.error(message);}}
  finally{if(mounted.current)setExporting(false);}
 };
 const openNew=()=>{setCreateError('');navigate(href()+'&novo=1');};
 return <section className="overtime-workspace">
  <nav className="overtime-breadcrumb" aria-label="Caminho do relatório"><ModuleLink href="/solicitacoes">Solicitações</ModuleLink><ChevronRight size={13}/>{id?<><ModuleLink href={href()}>Relatório de hora extra</ModuleLink><ChevronRight size={13}/><span aria-current="page">{report?dateLabel(report.dateFrom)+' a '+dateLabel(report.dateTo):'Detalhes'}</span></>:<span aria-current="page">Relatório de hora extra</span>}</nav>
  {id&&<ModuleLink className="request-back overtime-back" href={href()}><ArrowLeft size={16}/>Voltar para relatórios</ModuleLink>}
  <div className="companies-heading"><div><span className="eyebrow">SOLICITAÇÕES</span><h2>{id?'Funcionários e horas extras':'Relatório de hora extra'}</h2><p>{companyName}</p>{id&&report&&<span className={'overtime-status '+(isOpen?'open':'finished')}>{isOpen?'Em aberto':'Finalizado'}</span>}</div><div className="overtime-heading-actions">
   {!id&&canManage&&<button className="btn company-primary" type="button" disabled={mutations.creating} onClick={openNew}><Plus size={17}/>Novo relatório</button>}
   {id&&report&&<><button className="btn" type="button" onClick={()=>void exportPdf()} disabled={exporting||header.loading||!!detail.error||!report.employeeCount||(editing&&draftStatus!=='saved')}>{exporting?<Loader2 className="animate-spin" size={16}/>:<Download size={16}/>} {exporting?'Gerando…':'Exportar PDF'}</button>{canManage&&<>{isOpen?<>{!editing&&<button className="btn" type="button" disabled={busy} onClick={()=>{setFormError('');setDraftStatus('saved');navigate(href(id,true));}}><Pencil size={16}/>{report.employeeCount?'Editar funcionários':'Incluir funcionários'}</button>}<button className="btn company-primary" type="button" disabled={busy||!report.canFinish||(editing&&draftStatus!=='saved')} onClick={()=>void finish()}><CheckCircle2 size={16}/>Finalizar</button></>:<button className="btn company-primary" type="button" disabled={busy} onClick={async()=>{if(!await confirm({title:'Abrir relatório novamente?',description:'O relatório voltará para Em aberto e poderá receber alterações nos funcionários e nas horas.',confirmLabel:'Abrir novamente'}))return;try{await mutations.reopen({companyId,id:report.id,expectedUpdatedAt:report.updatedAt});if(mounted.current){notifications.updated('O relatório está em aberto novamente.');setDraftStatus('saved');navigate(href(id,true,'open'));}}catch(error){if(mounted.current)notifications.error(error instanceof Error?error.message:'Não foi possível abrir o relatório.');}}}><FolderOpen size={16}/>Abrir novamente</button>}<button className="btn overtime-delete" type="button" disabled={busy} onClick={()=>void remove(report)}><Trash2 size={16}/>Excluir</button></>}</>}
  </div></div>
  {options.error&&<ErrorState error={options.error} onRetry={()=>void options.reload()}/>}
  {id&&!options.loading&&!options.error&&!options.data?.employees.length&&<div className="overtime-notice"><Users size={20}/><p>Cadastre os funcionários com nome e cargo para preencher as horas.</p><ModuleLink className="text-link" href="/cadastro?secao=funcionarios">Abrir funcionários</ModuleLink></div>}
  {exportError&&<p className="form-error" role="alert">{exportError}</p>}
  {id?detail.loading?<Loading/>:detail.error?<ErrorState error={detail.error} onRetry={()=>void detail.reload()}/>:report&&<>
   {editing?canManage&&isOpen?<OvertimeForm key={id} report={report} companyId={companyId} employees={options.data?.employees??[]} canRegisterEmployees={options.data?.canRegisterEmployees??false} busy={mutations.finishing||mutations.reopening} onStatusChange={setDraftStatus} error={formError} onClose={()=>navigate(href(id))} onSave={save}/>:<p className="form-error" role="alert">{isOpen?'Você não tem permissão para editar este relatório.':'O relatório está finalizado e não pode ser alterado.'}</p>:<>
    <div className="overtime-metrics"><article><span>Horas extras 50%</span><strong>{report.total50}</strong></article><article><span>Horas extras 100%</span><strong>{report.total100}</strong></article><article><span>Funcionários</span><strong>{report.employeeCount}</strong></article></div>
    {report.notes&&<div className="overtime-report-notes"><strong>Observação</strong><p>{report.notes}</p></div>}
    <OvertimeSheet report={report} companyName={companyName}/>
   </>}
  </>:<>
   <OvertimeListFilters key={search+dateFrom+dateTo} search={search} dateFrom={dateFrom} dateTo={dateTo} onApply={(term,from,to)=>navigate(href(undefined,false,status,term,from,to))}/>
   <Tabs value={status} onValueChange={value=>navigate(href(undefined,false,value==='finished'?'finished':'open'))} className="overtime-tabs">
    <TabsList variant="line" aria-label="Situação dos relatórios"><TabsTrigger value="open"><Clock3 size={16}/>Em aberto{list.data&&<span className="overtime-tab-count">{list.data.counts.open}</span>}</TabsTrigger><TabsTrigger value="finished"><CheckCircle2 size={16}/>Finalizados{list.data&&<span className="overtime-tab-count">{list.data.counts.finished}</span>}</TabsTrigger></TabsList>
    <TabsContent value={status}>{list.loading?<Loading/>:list.error?<ErrorState error={list.error} onRetry={()=>void list.reload()}/>:!list.data?.reports.length?<div className="company-empty"><span className="company-empty-icon"><Clock3 size={25}/></span><h3>{status==='finished'?'Nenhum relatório finalizado':'Nenhum relatório em aberto'}</h3><p>{search||dateFrom?'Ajuste a busca ou o período para encontrar os relatórios.':status==='finished'?'Os relatórios concluídos aparecerão nesta aba.':'Crie o período para começar a incluir funcionários e horas extras.'}</p>{status==='open'&&canManage&&<button className="btn company-primary" onClick={openNew}><Plus size={16}/>Novo relatório</button>}</div>:<div className="overtime-report-grid">{list.data.reports.map(item=><ModuleLink className="overtime-report-card" key={item.id} href={href(item.id)} aria-label={'Abrir relatório de '+dateLabel(item.dateFrom)+' a '+dateLabel(item.dateTo)}>
     <div className="overtime-card-top"><span className={'overtime-status '+item.status}>{item.status==='open'?'Em aberto':'Finalizado'}</span><Clock3 size={18}/></div><h3>{dateLabel(item.dateFrom)}<span>a {dateLabel(item.dateTo)}</span></h3><p className="overtime-card-notes">{item.notes||item.sector||'Relatório de hora extra'}</p><dl><div><dt>50%</dt><dd>{item.total50}</dd></div><div><dt>100%</dt><dd>{item.total100}</dd></div></dl><footer><span><Users size={14}/>{item.employeeCount} funcionário(s)</span><ArrowRight size={17}/></footer>
    </ModuleLink>)}</div>}</TabsContent>
   </Tabs>
  </>}
  {!id&&creating&&canManage&&<OvertimeCreateModal companyId={companyId} busy={mutations.creating} error={createError} onClose={()=>navigate(href())} onSave={create}/>}
 </section>;
}
function Loading(){return <div className="client-loading" role="status"><Loader2 className="animate-spin" size={20}/>Carregando relatórios…</div>;}
function ErrorState({error,onRetry}:{error:string;onRetry:()=>void}){return <div className="company-empty" role="alert"><h3>Não foi possível carregar os dados</h3><p>{error}</p><button className="btn" onClick={onRetry}><RefreshCw size={16}/>Tentar novamente</button></div>;}
function OvertimeListFilters({search,dateFrom,dateTo,onApply}:{search:string;dateFrom:string;dateTo:string;onApply:(search:string,from:string,to:string)=>void}){
 const [term,setTerm]=useState(search),[from,setFrom]=useState(dateFrom),[to,setTo]=useState(dateTo);
 const submit=(event:FormEvent)=>{event.preventDefault();onApply(term,from,to);};
 return <form className="overtime-filters" onSubmit={submit}><Field label="Busca"><div className="overtime-search"><Search size={17}/><input type="search" maxLength={160} value={term} onChange={event=>setTerm(event.target.value)} placeholder="Buscar por funcionário, matrícula ou observação" aria-label="Buscar relatórios"/></div></Field><Field label="Data inicial"><input type="date" required={!!to} value={from} onChange={event=>setFrom(event.target.value)}/></Field><Field label="Data final"><input type="date" required={!!from} value={to} onChange={event=>setTo(event.target.value)}/></Field><button className="btn" type="submit"><Filter size={16}/>Filtrar</button>{(search||dateFrom||dateTo)&&<button className="btn overtime-clear-filter" type="button" onClick={()=>onApply('','','')}>Limpar filtros</button>}</form>;
}
