import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {Plus,CalendarDays,ChartNoAxesCombined,ChevronLeft,ChevronRight,Loader2,RefreshCw,Pencil} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {notifications} from '@/shared/feedback';
import {Accordion,AccordionItem,AccordionTrigger,AccordionContent} from '@/components/ui/accordion';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useAtr} from '../hooks/useAtr';
import {AtrForm} from '../forms/AtrForm';
import {atrMonths,formatAtrValue,groupAtrByYear} from '../utils/atrGrouping';
import type {AtrRecord} from '../types';

const quote=(value:string|null)=>value?formatAtrValue(value):'Não informada';
export function AtrPage(){
  const [page,setPage]=useState(1);
  const m=useAtr(page);
  const groups=useMemo(()=>groupAtrByYear(m.records),[m.records]);
  const [expanded,setExpanded]=useState<string[]|null>(null);
  const expandedYears=expanded??groups.map(group=>String(group.year));
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [draft,setDraft]=useState<{record?:AtrRecord;year?:number;month?:number}>({});

  useEffect(()=>{
    if(m.pagination.page!==page)setPage(m.pagination.page);
  },[m.pagination.page,page]);

  const begin=(year?:number,month?:number,record?:AtrRecord)=>{
    setDraft({year,month,record});setBusy(false);setOpen(true);
  };
  const goToPage=(nextPage:number)=>{setExpanded(null);setPage(nextPage);};
  const firstRecord=m.pagination.total?(m.pagination.page-1)*m.pagination.pageSize+1:0;
  const lastRecord=Math.min(m.pagination.page*m.pagination.pageSize,m.pagination.total);

  return <section className="atr-workspace">
    <nav className="client-breadcrumb atr-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><ChevronRight size={13}/><span aria-current="page">ATR</span></nav>
    <div className="companies-heading"><div><h2>ATR</h2><p>Cotações bruta e líquida, mensal e acumulada da safra, exibidas em páginas de 12 meses.</p></div>{!m.authRequired&&<button className="btn company-primary" disabled={m.loading||!!m.error} onClick={()=>begin()}><Plus size={17}/>Cadastrar mês</button>}</div>
    {m.loading?<div className="client-loading" role="status"><Loader2 className="animate-spin" size={20}/>Carregando registros…</div>
      :m.authRequired?<div className="company-empty"><span className="company-empty-icon"><ChartNoAxesCombined size={25}/></span><h3>Acesse seus registros de ATR</h3><p>Entre para consultar e salvar as quatro cotações oficiais.</p><Link className="btn company-primary" href="/login?returnTo=%2Fcadastro%3Fsecao%3Datr" target="_top">Entrar</Link></div>
      :m.error?<div className="company-empty" role="alert"><h3>Não foi possível carregar</h3><p>{m.error}</p><button className="btn" onClick={m.reload}><RefreshCw size={16}/>Tentar novamente</button></div>
      :!groups.length?<div className="company-empty"><span className="company-empty-icon"><CalendarDays size={25}/></span><h3>Cadastre o primeiro mês</h3><p>Informe mês, ano e as cotações brutas e líquidas.</p><button className="btn company-primary" onClick={()=>begin()}><Plus size={16}/>Cadastrar mês</button></div>
      :<>
        <Accordion type="multiple" value={expandedYears} onValueChange={setExpanded} className="atr-years">
          {groups.map(group=><AccordionItem value={String(group.year)} key={group.year} className="atr-year">
            <AccordionTrigger className="atr-year-trigger"><span className="atr-year-title"><CalendarDays size={19}/><strong>{group.year}</strong></span><span className="atr-year-count">{group.records.length} {group.records.length===1?'mês':'meses'} nesta página</span></AccordionTrigger>
            <AccordionContent className="atr-year-content"><div className="atr-month-grid">{group.records.map(record=>{
              const name=atrMonths[record.month-1];
              return <button key={record.id} type="button" className="atr-month filled" onClick={()=>begin(group.year,record.month,record)} aria-label={'Editar cotações de ATR de '+name+' de '+group.year}>
                <span className="atr-month-heading">{name}<Pencil size={13}/></span>
                <span className="atr-quotes">
                  <span className="atr-quote-group"><b>Mensal</b><span><small>Bruto</small><strong>{quote(record.monthlyGrossValue)}</strong></span><span><small>Líquido</small><strong>{quote(record.monthlyNetValue)}</strong></span></span>
                  <span className="atr-quote-group"><b>Acumulado</b><span><small>Bruto</small><strong>{quote(record.accumulatedGrossValue)}</strong></span><span><small>Líquido</small><strong>{quote(record.accumulatedNetValue)}</strong></span></span>
                </span>
              </button>;
            })}</div></AccordionContent>
          </AccordionItem>)}
        </Accordion>
        <nav className="atr-pagination" aria-label="Paginação dos registros de ATR"><span className="atr-pagination-summary"><strong>{firstRecord}–{lastRecord}</strong> de {m.pagination.total} registros</span><div className="atr-pagination-controls"><button className="btn" type="button" disabled={!m.pagination.hasPrevious} onClick={()=>goToPage(m.pagination.page-1)} aria-label="Página anterior"><ChevronLeft size={16}/>Anterior</button><span>Página <strong>{m.pagination.page}</strong> de {m.pagination.totalPages}</span><button className="btn" type="button" disabled={!m.pagination.hasNext} onClick={()=>goToPage(m.pagination.page+1)} aria-label="Próxima página">Próxima<ChevronRight size={16}/></button></div></nav>
      </>}
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}>
      <DialogContent className="form-modal atr-modal" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}>
        <DialogHeader><DialogTitle>{draft.record?'Editar cotações de ATR':'Cadastrar cotações de ATR'}</DialogTitle><DialogDescription>Informe os valores brutos e os líquidos após deduções legais, no mês e no acumulado da safra.</DialogDescription></DialogHeader>
        <AtrForm {...draft} onBusy={setBusy} onClose={()=>{setBusy(false);setOpen(false);}} onSave={async(input,id)=>{const result=await m.save(input,id);setPage(1);setExpanded(null);if(id)notifications.updated('As quatro cotações de '+atrMonths[result.month-1]+' de '+result.year+' foram atualizadas.');else notifications.created('As quatro cotações de '+atrMonths[result.month-1]+' de '+result.year+' foram cadastradas.');}}/>
      </DialogContent>
    </Dialog>
  </section>;
}
