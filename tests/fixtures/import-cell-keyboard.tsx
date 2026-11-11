import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ImportEditableCell} from '../../modules/importacoes/components/ImportEditableCell';
import {useImportCellNavigation} from '../../modules/importacoes/hooks/useImportCellNavigation';
import type {ImportField} from '../../modules/importacoes/types';
const field=(key:string,type:'text'|'decimal'):ImportField=>({key,type,label:key,column:'',source:'manual',required:false,defaultValue:''});
const equipment=['COD_EQUIPAMENTO_TRANSPORTE','COD_EQUIPAMENTO_COMPARTIMENTO'];
const fields=[field('COD_TALHAO','decimal'),field('COD_DESTINO','text'),field('PESOBRUTO','decimal'),...equipment.map(key=>field(key,'decimal'))];
const entries=['row-one','row-two','row-three','row-four','row-five','row-six','row-seven'].map((id,index)=>({id,groupKey:index<2?'group-a':index<5?'group-b':'group-c'}));
const state={calls:[] as Array<{entryId:string;key:string;value:string;revision:string}>,revision:0,delay:850};
Object.assign(window,{keyboardFixture:state});
function Fixture(){
 const gridRef=useRef<HTMLDivElement>(null);const [busy,setBusy]=useState(false),[updating,setUpdating]=useState(false);
 const [revision,setRevision]=useState('0');const [values,setValues]=useState<Record<string,string>>({});
 const navigate=useImportCellNavigation({gridRef,entries,fields,blocked:busy,updating});
 async function save(entryId:string,key:string,value:string,expected:string){
  if(expected!==String(state.revision))throw Error('Stale revision');
  if(value==='invalid')throw Error('Invalid number');
  state.calls.push({entryId,key,value,revision:expected});setBusy(true);
  await new Promise(resolve=>setTimeout(resolve,50));
  const affected=equipment.includes(key)?entries.filter(entry=>entry.groupKey===entries.find(entry=>entry.id===entryId)?.groupKey):[{id:entryId}];
  const keys=equipment.includes(key)?equipment:[key];
  setValues(current=>({...current,...Object.fromEntries(affected.flatMap(entry=>keys.map(fieldKey=>[entry.id+fieldKey,value])))}));setBusy(false);setUpdating(true);
  // A second refresh can outlive the save promise, as with Realtime/refetch.
  setTimeout(()=>{state.revision++;setRevision(String(state.revision));setUpdating(false);},state.delay);
  return true;
 }
 return <><button id="outside">Outside grid</button><div ref={gridRef} data-updating={updating}><table><tbody>{entries.map((entry,index)=><tr key={entry.id}>{fields.map(f=><td key={f.key}><ImportEditableCell entryId={entry.id} field={f} value={values[entry.id+f.key]??''} revision={revision} rowNumber={index+1}
  blocked={busy||updating} saveUnchanged={f.key==='COD_TALHAO'||equipment.includes(f.key)} onSave={(value,expected)=>save(entry.id,f.key,value,expected)} onNavigate={move=>navigate(entry.id,f.key,move)}/></td>)}</tr>)}</tbody></table></div></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
