import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const pagePath=new URL('../modules/pedidos/components/PedidosPage.tsx',import.meta.url);
const migrationPath=new URL('../supabase/migrations/20260929130228_purchase_order_optional_contact.sql',import.meta.url);

test('purchase orders keep contacts optional and expose registered contacts clearly',async()=>{
  const [source,migration]=await Promise.all([
    readFile(pagePath,'utf8'),
    readFile(migrationPath,'utf8'),
  ]);
  const start=source.indexOf('function PurchaseOrderDetail(');
  const detail=source.slice(start,source.indexOf('\nfunction ',start+1));

  assert.notEqual(start,-1);
  assert.doesNotMatch(detail,/purchaseOrderNumber\.trim\(\)&&!form\.providerContactId/);
  assert.match(detail,/Contato responsável pela OC \(opcional\)/);
  assert.match(detail,/currentContacts\.length\?`Selecionar contato \(\$\{currentContacts\.length\}/);
  assert.match(detail,/value=\{form\.providerContactId\?\?''\}/);
  assert.match(detail,/Opcional — o pedido pode ser salvo normalmente/);

  assert.doesNotMatch(migration,/Selecione (?:e salve )?o contato responsável pela ordem de compra/);
  assert.match(migration,/provider_id=v_order\.provider_id[\s\S]*id=v_provider_contact_id AND deleted_at IS NULL FOR SHARE/);
});

test('a payment method can be created and selected without leaving the order draft',async()=>{
  const [source,formSource]=await Promise.all([
    readFile(pagePath,'utf8'),
    readFile(new URL('../modules/cadastro/formas-pagamento/components/PaymentMethodForm.tsx',import.meta.url),'utf8'),
  ]);
  const start=source.indexOf('function PurchaseOrderDetail(');
  const detail=source.slice(start,source.indexOf('\nfunction ',start+1));

  assert.match(detail,/usePaymentMethodMutations\(\)/);
  assert.match(detail,/<button className="btn purchase-order-payment-method-add" type="button" aria-label="Cadastrar nova forma de pagamento"/);
  assert.match(detail,/creatingPaymentMethod&&<PaymentMethodForm/);

  const commercialStart=detail.indexOf('<form className="purchase-order-panel purchase-order-commercial"');
  const commercialEnd=detail.indexOf('</form>',commercialStart);
  const modalAt=detail.indexOf('{creatingPaymentMethod&&<PaymentMethodForm');
  assert.ok(commercialStart>=0&&commercialEnd>commercialStart&&modalAt>commercialEnd,'the nested dialog must remain outside the purchase-order form');

  const saveAt=detail.indexOf('const saved=await paymentMethodMutations.save(input)');
  const selectAt=detail.indexOf("set('paymentMethodId',saved.id)",saveAt);
  const feedbackAt=detail.indexOf('notifications.created(',selectAt);
  const closeAt=detail.indexOf('setCreatingPaymentMethod(false)',feedbackAt);
  assert.ok(saveAt>=0&&selectAt>saveAt&&feedbackAt>selectAt&&closeAt>feedbackAt,'the returned payment method must be selected before feedback and closing');
  assert.match(formSource,/import '\.\.\/styles\.css';/);
});

test('purchase-order cards contain long provider names without pushing values outside',async()=>{
  const styles=await readFile(new URL('../modules/pedidos/styles.css',import.meta.url),'utf8');
  assert.match(styles,/\.purchase-order-card\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(styles,/\.purchase-order-card>\*\{min-width:0;max-width:100%\}/);
  assert.match(styles,/\.purchase-order-company h3,\.purchase-order-company p\{overflow-wrap:anywhere\}/);
  assert.match(styles,/\.purchase-order-company p\{[^}]*white-space:normal[^}]*-webkit-line-clamp:2/);
  assert.match(styles,/\.purchase-order-card header \.purchase-order-status,\.purchase-order-card footer>strong\{flex:none;white-space:nowrap\}/);
});


const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

function pdfDependencies(){
  return {name:'purchase-order-pdf-fixtures',setup(builder){
    builder.onResolve({filter:/^@\/shared\/reporting\/loadReportImage$/},()=>({path:'images',namespace:'purchase-order-test'}));
    builder.onLoad({filter:/^images$/,namespace:'purchase-order-test'},()=>({loader:'js',contents:`export async function loadReportImage(url){return url?{bytes:Uint8Array.from(Buffer.from('${pixel}','base64')),format:'PNG',ratio:1}:null;}`}));
    builder.onResolve({filter:/^@\/shared\/reporting\/jsPdfRuntime$/},()=>({path:'runtime',namespace:'purchase-order-test'}));
    builder.onResolve({filter:/^jspdf$/,namespace:'purchase-order-test'},()=>({path:require.resolve('jspdf')}));
    builder.onLoad({filter:/^runtime$/,namespace:'purchase-order-test'},()=>({loader:'js',contents:`
      import {jsPDF as ActualJsPdf} from 'jspdf';
      export function jsPDF(options){
        const doc=new ActualJsPdf(options),text=doc.text.bind(doc),addImage=doc.addImage.bind(doc);
        doc.textDraws=[];doc.imageDraws=[];
        doc.text=(value,x,y,...rest)=>{doc.textDraws.push({value:Array.isArray(value)?value.join(' '):String(value),x,y,page:doc.getCurrentPageInfo().pageNumber});return text(value,x,y,...rest);};
        doc.addImage=(bytes,format,x,y,width,height,...rest)=>{doc.imageDraws.push({x,y,width,height,page:doc.getCurrentPageInfo().pageNumber});return addImage(bytes,format,x,y,width,height,...rest);};
        return doc;
      }
    `}));
  }};
}

const company={id:'company',name:'EMPRESA AGRICOLA LTDA EM RECUPERACAO JUDICIAL',legalName:'',cnpj:'12345678000195',phone:'11999999999',email:'',street:'FAZENDA SANTA ANA',number:'S/N',complement:'',district:'ZONA RURAL',city:'JAPOATA',state:'SE',zipCode:'49950000',logoUrl:null};
const brand={company,header:{variant:'detailed',logoAlignment:'left',showCnpj:true,showContact:true},watermark:{imageUrl:null,opacity:100,size:100},issuer:{id:'tester',name:'Teste PDF',email:''},issuedAt:new Date('2026-11-16T15:00:00-03:00')};
const names=['Rolamento de encosto — 81781200','Rolamento — 6205','Disco de embreagem — 80031030','Platô de embreagem (conforme amostra) — 80882400','Parafuso Allen — HC9336'];
function fixture(count=5){
  return {id:'order',number:'PED-001',status:'open',quotationNumber:'435',purchaseOrderNumber:'',requestDate:'2026-11-16',providerLegalName:'FORNECEDOR DE PECAS COMERCIO LTDA',providerTradeName:'Fornecedor Peças',providerDocumentType:'CNPJ',providerDocument:'12345678000195',providerPhone:'',providerEmail:'',providerContactName:'',providerContactPhone:'',paymentMethod:'30/60/90',total:'3100',itemCount:count,items:Array.from({length:count},(_,index)=>({id:`item-${index}`,materialName:names[index]??`Produto adicional ${index+1}`,materialInternalCode:`MAT-${index}`,materialReferences:[{brand:'',code:`REF-${index}`}],materialImageUrl:`fixture://photo-${index}`,quantity:index===4?'4':'1',unit:'PC',unitPrice:['295','30','855','1900','5'][index]??'10',lineTotal:['295','30','855','1900','20'][index]??'10',notes:index===3?'Conforme amostra.':''}))};
}

test('purchase-order PDF fits five photographed products and the total on one A4 page',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'purchase-order-pdf-'));
  try{
    const outfile=join(directory,'purchase-order.mjs');
    await build({entryPoints:['modules/pedidos/reporting/purchaseOrderPdf.ts'],outfile,bundle:true,platform:'node',format:'esm',plugins:[pdfDependencies()],logLevel:'silent'});
    const {createPurchaseOrderPdf,createPurchaseOrderSnapshot}=await import(pathToFileURL(outfile));
    const order=fixture(),before=JSON.stringify(order),snapshot=createPurchaseOrderSnapshot(order);
    const {doc}=await createPurchaseOrderPdf(snapshot,brand);
    assert.equal(doc.getNumberOfPages(),1,'all five items and the grand total must fit together');
    assert.equal(JSON.stringify(order),before,'export must preserve the order and server prices');
    assert.notEqual(snapshot.items,order.items);
    const text=doc.textDraws.map(draw=>draw.value).join(' ');
    for(const value of ['PED-001','435','16/11/2026','FORNECEDOR DE PECAS COMERCIO LTDA','Fornecedor Peças','12.345.678/0001-95','30/60/90','Em aberto','HC9336','TOTAL DO PEDIDO','3.100,00','1 / 1'])assert.ok(text.includes(value),`missing ${value}`);
    assert.ok(!text.includes('Não informado'),'empty optional contacts should not create placeholder rows');
    assert.equal(doc.imageDraws.length,5);
    assert.ok(doc.imageDraws.every(image=>image.height>=19&&image.page===1),'photos must retain their legible size');
    const total=doc.textDraws.find(draw=>draw.value==='TOTAL DO PEDIDO');
    const lastPhoto=doc.imageDraws.at(-1);
    assert.ok(total.y>lastPhoto.y+lastPhoto.height,'total must follow the final product');
    assert.ok(doc.textDraws.filter(draw=>!draw.value.startsWith('Emitido por')&&!/^\d+ \/ \d+$/.test(draw.value)).every(draw=>draw.y<274),'content must stay above the footer');

    const withContacts=fixture();
    Object.assign(withContacts,{providerPhone:'(79) 3333-4444',providerEmail:'vendas@fornecedor.example',providerContactName:'Responsável de compras',providerContactPhone:'(79) 99999-2222',purchaseOrderNumber:'OC-2026-123'});
    const contactPdf=await createPurchaseOrderPdf(withContacts,brand);
    const contactText=contactPdf.doc.textDraws.map(draw=>draw.value).join(' ');
    for(const value of ['(79) 3333-4444','vendas@fornecedor.example','Responsável de compras','(79) 99999-2222','OC-2026-123'])assert.ok(contactText.includes(value),`filled contacts must remain visible: ${value}`);

    const many=fixture(12),large=await createPurchaseOrderPdf(many,brand);
    assert.ok(large.doc.getNumberOfPages()>1,'larger orders must continue across pages');
    assert.equal(large.doc.imageDraws.length,12);
    const largeText=large.doc.textDraws.map(draw=>draw.value).join(' ');
    assert.ok(largeText.includes('Produto adicional 12'));
    assert.ok(largeText.includes('continuação'));
    assert.ok(largeText.includes('TOTAL DO PEDIDO'));
  }finally{
    assert.ok(resolve(directory).startsWith(join(resolve(tmpdir()),'purchase-order-pdf-')));
    await rm(directory,{recursive:true,force:true});
  }
});
