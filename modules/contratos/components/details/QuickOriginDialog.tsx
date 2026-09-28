import {useEffect,useRef,useState} from 'react';
import {LandPlot,Loader2,Save,Tractor} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Choice,Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {useFarms} from '@/modules/cadastro/fazenda/hooks/useFarms';
import {brazilStates} from '@/modules/cadastro/fazenda/utils/farmFields';
import type {Farm,FarmInput} from '@/modules/cadastro/fazenda/types';
import {usePlotsMutation} from '@/modules/cadastro/talhoes/hooks/usePlots';
import type {Plot,PlotInput} from '@/modules/cadastro/talhoes/types';

type CreatedOrigin={farm:Farm;plot?:Plot};

export function QuickOriginDialog({onClose,onCreated,returnFocus}:{onClose:()=>void;onCreated:(origin:CreatedOrigin)=>void;returnFocus:()=>void}){
 const farms=useFarms(),plots=usePlotsMutation();
 const [farm,setFarm]=useState<FarmInput>({name:'',areaHa:'',city:'',state:''});
 const [includePlot,setIncludePlot]=useState(false);
 const [plot,setPlot]=useState<PlotInput>({name:'',areaHa:''});
 const [createdFarm,setCreatedFarm]=useState<Farm|null>(null);
 const [error,setError]=useState('');
 const mounted=useRef(true),inFlight=useRef(false);
 const saving=farms.saving||plots.saving;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const close=()=>{if(!saving&&!inFlight.current)onClose();};
 const changeFarm=(key:keyof FarmInput,value:string)=>{setFarm(current=>({...current,[key]:value}));setError('');};
 const changePlot=(key:keyof PlotInput,value:string)=>{setPlot(current=>({...current,[key]:value}));setError('');};
 const save=async(event:React.FormEvent)=>{
  event.preventDefault();
  if(inFlight.current)return;
  if(!farm.state&&!createdFarm){setError('Selecione a UF da fazenda.');return;}
  inFlight.current=true;setError('');
  let persistedFarm=createdFarm;
  try{
   if(!persistedFarm){
    persistedFarm=await farms.save(farm);
    if(!mounted.current)return;
    setCreatedFarm(persistedFarm);
    onCreated({farm:persistedFarm});
   }
   let persistedPlot:Plot|undefined;
   if(includePlot){
    const result=await plots.save(persistedFarm.id,plot);
    persistedPlot=result.plots.find(item=>item.name.localeCompare(plot.name.trim(),'pt-BR',{sensitivity:'base'})===0);
    if(!persistedPlot)throw new Error('A fazenda foi cadastrada, mas o talhão não foi retornado. Tente salvar o talhão novamente.');
   }
   if(!mounted.current)return;
   onCreated({farm:persistedFarm,plot:persistedPlot});
   notifications.created(includePlot?'A fazenda e o talhão foram cadastrados e selecionados.':'A fazenda foi cadastrada e selecionada.');
   onClose();
  }catch(reason){
   if(mounted.current){
    const detail=(reason as Error).message||'Não foi possível cadastrar a origem.';
    const message=persistedFarm&&includePlot?`A fazenda foi cadastrada, mas o talhão não foi salvo. ${detail}`:detail;
    setError(message);notifications.error(message);
   }
  }finally{inFlight.current=false;}
 };
 return <Dialog open onOpenChange={open=>{if(!open)close();}}>
  <DialogContent className="form-modal quick-origin-modal" showCloseButton={!saving} onCloseAutoFocus={event=>{event.preventDefault();returnFocus();}} onEscapeKeyDown={event=>{if(saving)event.preventDefault();}} onPointerDownOutside={event=>event.preventDefault()}>
   <DialogHeader><DialogTitle><Tractor size={20}/>Cadastrar origem</DialogTitle><DialogDescription>Cadastre a fazenda sem sair do carregamento. O talhão é opcional.</DialogDescription></DialogHeader>
   <form className="quick-origin-form" onSubmit={event=>void save(event)}>
    <fieldset className="company-fieldset" disabled={saving||!!createdFarm}>
     <Field label="Nome da fazenda *"><input autoFocus required minLength={2} maxLength={150} value={farm.name} onChange={event=>changeFarm('name',event.target.value)} placeholder="Ex.: Fazenda Boa Vista"/></Field>
     <Field label="Área da fazenda *"><div className="farm-area-input"><input required inputMode="decimal" maxLength={16} value={farm.areaHa} onChange={event=>changeFarm('areaHa',event.target.value)} placeholder="Ex.: 125,50"/><span aria-hidden="true">ha</span></div></Field>
     <div className="form-grid farm-location-grid"><Field label="Cidade *"><input required minLength={2} maxLength={100} value={farm.city} onChange={event=>changeFarm('city',event.target.value)} placeholder="Nome da cidade" autoComplete="address-level2"/></Field><Field label="UF *"><Choice label="UF da fazenda" value={farm.state} onChange={value=>changeFarm('state',value)} items={brazilStates.map(value=>({value,label:value}))}/></Field></div>
    </fieldset>
    {createdFarm&&<p className="quick-origin-persisted" role="status"><Tractor size={16}/><span><strong>{createdFarm.name}</strong> já foi cadastrada. Você pode tentar o talhão novamente ou continuar sem ele.</span></p>}
    <label className="quick-origin-plot-toggle"><input type="checkbox" checked={includePlot} disabled={saving} onChange={event=>{setIncludePlot(event.target.checked);setError('');}}/><span><LandPlot size={18}/><span><strong>Adicionar talhão agora</strong><small>Opcional. Você também pode cadastrar o talhão depois.</small></span></span></label>
    {includePlot&&<fieldset className="company-fieldset quick-origin-plot-fields" disabled={saving}><div className="form-grid"><Field label="Nome do talhão *"><input required minLength={2} maxLength={150} value={plot.name} onChange={event=>changePlot('name',event.target.value)} placeholder="Ex.: Talhão 01"/></Field><Field label="Área do talhão *"><div className="farm-area-input"><input required inputMode="decimal" maxLength={16} value={plot.areaHa} onChange={event=>changePlot('areaHa',event.target.value)} placeholder="Ex.: 20,00"/><span aria-hidden="true">ha</span></div></Field></div></fieldset>}
    {error&&<p id="quick-origin-error" className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="btn" disabled={saving} onClick={close}>Cancelar</button><button type="submit" className="btn company-primary" disabled={saving}>{saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>} {saving?'Salvando…':createdFarm&&includePlot?'Tentar salvar talhão':includePlot?'Cadastrar fazenda e talhão':'Cadastrar fazenda'}</button></div>
   </form>
  </DialogContent>
 </Dialog>;
}
