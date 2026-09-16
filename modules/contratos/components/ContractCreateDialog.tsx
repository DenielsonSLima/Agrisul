import {useEffect,useRef,useState} from 'react';
import {CalendarDays,CircleDollarSign,FileText,Hash,Loader2,Plus,RefreshCw,Save,Users,Weight} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Choice,Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {formatCnpj} from '@/shared/utils/cnpj';
import {useContractTypesMutation} from '@/modules/cadastro/contratos/hooks/useContractTypes';
import {useContractOptions} from '../hooks/useContractOptions';
import {useContractsMutation} from '../hooks/useContracts';
import type {ContractAtrPeriodType,ContractAtrPriceType} from '../types';
import {contractHref,contractsHref} from '../utils/contractFormat';

function localToday(){
 const now=new Date();
 return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
}

export function ContractCreateDialog(){
 const options=useContractOptions(),contractMutation=useContractsMutation(),typeMutation=useContractTypesMutation(),{navigate}=useModuleNavigation();
 const [date,setDate]=useState(localToday);const [contractNumber,setContractNumber]=useState('');const [clientId,setClientId]=useState('');const [typeId,setTypeId]=useState('');const [volume,setVolume]=useState('');
 const [atrPriceType,setAtrPriceType]=useState<ContractAtrPriceType|''>('');const [atrPeriodType,setAtrPeriodType]=useState<ContractAtrPeriodType|''>('');
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const [showTypeCreator,setShowTypeCreator]=useState(false),[typeName,setTypeName]=useState(''),[typeError,setTypeError]=useState(''),[creatingType,setCreatingType]=useState(false);
 const mounted=useRef(true),inFlight=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const close=()=>{if(!inFlight.current&&!creatingType)navigate(contractsHref);};
 const ready=!!options.activeCompany&&!!options.clients.length&&!!options.types.length;

 async function createType(){
  if(creatingType||saving)return;
  const name=typeName.trim();
  if(name.length<2){setTypeError('Informe um nome com pelo menos 2 caracteres.');return;}
  setTypeError('');
  try{
   setCreatingType(true);
   const saved=await typeMutation.mutateAsync({input:{name,stages:[]}});
   if(mounted.current){setTypeId(saved.id);setTypeName('');setShowTypeCreator(false);notifications.created('O tipo de contrato foi cadastrado e selecionado.');}
  }catch(reason){
   if(mounted.current){const message=(reason as Error).message;setTypeError(message);notifications.error(message);}
  }finally{if(mounted.current)setCreatingType(false);}
 }

 return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="form-modal contract-create-modal" onEscapeKeyDown={event=>{if(saving||creatingType)event.preventDefault();}} onPointerDownOutside={event=>{if(saving||creatingType)event.preventDefault();}}>
  <DialogHeader><DialogTitle>Novo contrato</DialogTitle><DialogDescription>Defina o cliente, o volume e o critério de ATR para {options.activeCompany?.name??'a empresa ativa'}.</DialogDescription></DialogHeader>
  {options.loading?<div className="contract-modal-state" role="status"><Loader2 className="animate-spin" size={19}/>Carregando empresas, parceiros e tipos de contrato…</div>:options.error?<div className="contract-modal-error" role="alert"><p>{options.error}</p>{options.status!==401&&<button type="button" className="btn" onClick={()=>{void options.reload();}}><RefreshCw size={15}/>Tentar novamente</button>}</div>:<form onSubmit={async event=>{
   event.preventDefault();if(inFlight.current||creatingType)return;setError('');
   const company=options.activeCompany,client=options.clients.find(item=>item.id===clientId),type=options.types.find(item=>item.id===typeId);
   if(!date||!company||!client||!type||!volume.trim()||!atrPriceType||!atrPeriodType){setError('Informe a data, o parceiro, o tipo, o volume e as duas opções de ATR.');return;}
   try{inFlight.current=true;setSaving(true);const saved=await contractMutation.mutateAsync({input:{title:(type.name+' — '+client.legalName).slice(0,150).trim(),contractNumber,companyId:company.id,clientId,typeId,status:'Ativo',startDate:date,endDate:'',contractedVolume:volume,atrPriceType,atrPeriodType,value:'',notes:''}});if(mounted.current){notifications.created('O contrato foi cadastrado como ativo e já está disponível para acompanhamento.');navigate(contractHref(saved.id),{replace:true});}}
   catch(reason){if(mounted.current){const message=(reason as Error).message;setError(message);notifications.error(message);}}
   finally{inFlight.current=false;if(mounted.current)setSaving(false);}
  }}>
   <fieldset className="company-fieldset" disabled={saving||creatingType}>
    <Field label="Data do contrato *"><div className="contract-date-field"><CalendarDays size={16}/><input type="date" min="1900-01-01" max="9999-12-31" required value={date} onChange={event=>setDate(event.target.value)} autoFocus/></div></Field>
    <Field label="Número do contrato (opcional)"><div className="contract-date-field"><Hash size={16}/><input maxLength={100} value={contractNumber} onChange={event=>setContractNumber(event.target.value)} placeholder="Ex.: 123/2026"/></div></Field>
    {options.activeCompany&&<p className="contract-inline-company">Empresa ativa: <strong>{options.activeCompany.name}</strong></p>}
    <Field label="Parceiro (cliente) *"><Choice label={options.clients.length?'Selecione o parceiro':'Nenhum parceiro cadastrado'} value={clientId} onChange={setClientId} disabled={!options.clients.length} items={options.clients.map(client=>({value:client.id,label:client.legalName,description:'CNPJ: '+formatCnpj(client.cnpj)}))}/></Field>
    {!options.clients.length&&<p className="contract-inline-notice" role="status"><Users size={16}/>Cadastre um parceiro em Cadastros para disponibilizá-lo nesta seleção.</p>}
    <Field label="Volume do contrato (t) *"><div className="contract-date-field"><Weight size={16}/><input required inputMode="decimal" maxLength={18} value={volume} onChange={event=>setVolume(event.target.value)} placeholder="Ex.: 25.000,000"/></div></Field>
    <div className="form-grid"><Field label="Valor do ATR *"><Choice label="Selecione bruto ou líquido" value={atrPriceType} onChange={value=>setAtrPriceType(value as ContractAtrPriceType)} items={[{value:'gross',label:'Bruto'},{value:'net',label:'Líquido'}]}/></Field><Field label="Período do ATR *"><Choice label="Selecione mensal ou acumulado" value={atrPeriodType} onChange={value=>setAtrPeriodType(value as ContractAtrPeriodType)} items={[{value:'monthly',label:'Mensal'},{value:'accumulated',label:'Acumulado'}]}/></Field></div>
    <p className="contract-atr-help"><CircleDollarSign size={16}/>O faturamento usará a quantidade (t) × ATR medido do carregamento (kg/t) × cotação escolhida (R$/kg) do mês anterior à data do carregamento.</p>
    <Field label="Tipo de contrato *"><Choice label={options.types.length?'Selecione o tipo de contrato':'Nenhum tipo cadastrado'} value={typeId} onChange={setTypeId} disabled={!options.types.length} items={options.types.map(type=>({value:type.id,label:type.name}))}/></Field>
    {showTypeCreator||!options.types.length?<section className="contract-inline-type" aria-label="Cadastrar tipo de contrato">
     <div><FileText size={17}/><span><strong>Novo tipo de contrato</strong><small>Crie o tipo aqui, sem sair deste modal.</small></span></div>
     <div className="contract-inline-type-fields"><input aria-label="Nome do novo tipo de contrato" minLength={2} maxLength={150} value={typeName} onChange={event=>setTypeName(event.target.value)} placeholder="Ex.: Contrato manual" onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void createType();}}}/><button type="button" className="btn" disabled={creatingType||typeName.trim().length<2} onClick={()=>{void createType();}}>{creatingType?<Loader2 className="animate-spin" size={15}/>:<Save size={15}/>} {creatingType?'Salvando…':'Salvar tipo'}</button></div>
     {typeError&&<p className="form-error" role="alert">{typeError}</p>}
     {!!options.types.length&&<button type="button" className="contract-inline-cancel" onClick={()=>{setShowTypeCreator(false);setTypeError('');}}>Cancelar novo tipo</button>}
    </section>:<button type="button" className="contract-add-type" onClick={()=>setShowTypeCreator(true)}><Plus size={15}/>Cadastrar outro tipo neste modal</button>}
   </fieldset>
   {!ready&&!!options.activeCompany&&!!options.clients.length&&<p className="contract-inline-notice" role="status"><FileText size={16}/>Cadastre o primeiro tipo acima para continuar.</p>}
   {error&&<p className="form-error" role="alert">{error}</p>}
   <div className="form-actions"><button type="button" className="btn" disabled={saving||creatingType} onClick={close}>Cancelar</button><button type="submit" className="btn company-primary" disabled={saving||creatingType||!ready}>{saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>} {saving?'Salvando…':'Criar contrato'}</button></div>
  </form>}
 </DialogContent></Dialog>;
}
