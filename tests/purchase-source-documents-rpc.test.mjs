import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('source documents preserve grouped service numbers, quantities, audit time, retries and workspace isolation',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const source={requestedOn:'2026-09-10',requestNumber:'487',itemType:'service',materialId:null,categoryId:null,reference:'',quantity:'1',unit:'PC',application:'Caminhão Volvo nº 430',urgent:true,status:'open',notes:'',vehicleIds:[]};
 try{
  const signature=(await rpc('signatures','save',{name:'Solicitante de teste',role:'requester'})).signature;
  for(const [description,quantity] of [['Conserto de maneco','1'],['Conserto de válvula','2']])await rpc('purchase-requests','save',{...source,id:randomUUID(),description,quantity});
  const input={requestId:randomUUID(),purchaseRequestNumber:'487',requesterSignatureId:signature.id,requesterSigningMode:'manual',companyName:'Prestador a definir',companyAddress:'',items:[],serviceValue:null,returnDate:null,notes:'',attachmentIds:[]};
  const saved=(await rpc('service-requests','create',input)).request;
  assert.equal(saved.number,487);assert.equal(saved.items.length,2);assert.equal(saved.providerId,null);assert.equal(saved.status,'pending');assert.equal(saved.serviceValue,null);
  assert.ok(saved.items.some(i=>i.description.includes('Quantidade: 2 PC')));assert.match(saved.notes,/10\/09\/2026/);assert.ok(saved.documentHash);
  assert.equal((await rpc('service-requests','create',input)).request.id,saved.id,'retry keeps the existing document');
  const normal=(await rpc('service-requests','create',{...input,requestId:randomUUID(),purchaseRequestNumber:undefined,items:[{description:'Novo serviço normal',application:'Trator'}]})).request;
  assert.equal(normal.number,488,'normal automatic numbering remains intact');
  await assert.rejects(()=>rpc('service-requests','create',{...input,requestId:normal.id}),e=>e.code==='23505');
  for(const purchaseRequestNumber of ['0','999','487 OR 1=1'])await assert.rejects(()=>rpc('service-requests','create',{...input,requestId:randomUUID(),purchaseRequestNumber}),e=>e.code==='22023');
  const material=(await rpc('materials','save',{name:'Filtro de teste',internalCode:'SOURCE-MAT',unit:'PC',application:'Trator'})).material;
  const quote=(await rpc('quotations','save',{title:'Solicitação de compra nº 394',number:'394',requestDate:'2026-10-02',requesterSignatureId:signature.id,notes:'Sem fornecedores ou valores atribuídos',items:[{id:randomUUID(),materialId:material.id,quantity:'8',notes:'Referência original'}],providers:[]})).quote;
  assert.equal(quote.number,'394');assert.equal(quote.items[0].quantity,'8');assert.equal(quote.providers.length,0);
  await setActor(ids.otherOwner);
  const other=(await rpc('signatures','save',{name:'Outra pessoa',role:'requester'})).signature;
  await assert.rejects(()=>rpc('service-requests','create',{...input,requestId:randomUUID(),requesterSignatureId:other.id}),e=>e.code==='22023');
  await setActor(ids.reader);await assert.rejects(()=>rpc('service-requests','create',input),e=>e.code==='42501');
  await setActor(null);await assert.rejects(()=>rpc('service-requests','create',input),e=>e.code==='28000');
 }finally{await db.close();}
});
