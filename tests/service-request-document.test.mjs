import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {jsPDF} from 'jspdf';

const require = createRequire(import.meta.url), {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));
const directory = await mkdtemp(join(tmpdir(), 'request-document-'));
try {
  const output = join(directory, 'document.mjs');
  await build({stdin: {contents: "export * from './modules/solicitacoes/reporting/renderDocumentPdf'; export * from './modules/solicitacoes/reporting/requestVerification'; export * from './modules/solicitacoes/reporting/requestPdfAudit'; export * from './shared/reporting/qrCode'; export * from './modules/cadastro/modelos-documentos/defaultLayout'; export * from './shared/reporting/documentWatermark'; export * from './shared/reporting/pdfWatermark'; export * from './shared/reporting/pdfHeader'; export * from './modules/cadastro/modelos-documentos/reportHeaderLayout';", resolveDir: process.cwd(), loader: 'ts'}, outfile: output, bundle: true, platform: 'node', format: 'esm'});
  const {renderDocumentPdf, requestVerificationUrl, checkDocumentHash, qrMatrix, qrSvgDataUrl, defaultServiceRequestLayout, legacyServiceRequestLayout, documentExampleData, documentWatermark, drawReportPdfWatermark, drawReportPdfHeader, layoutWithReportHeader, DOCUMENT_BODY_TOP, DOCUMENT_BODY_BOTTOM, drawRequestPdfAudit, drawRequestPdfFooters} = await import(pathToFileURL(output));
  const request = {id: '11111111-1111-4111-8111-111111111111', documentHash: 'a'.repeat(64)};
  const url = requestVerificationUrl(request, 'https://faturamento.example');
  assert.equal(new URL(url).searchParams.get('verificar'), request.documentHash);
  assert.equal(checkDocumentHash(request.documentHash, request.documentHash), 'valid');
  assert.equal(checkDocumentHash('b'.repeat(64), request.documentHash), 'invalid');
  assert.equal(checkDocumentHash(null, request.documentHash), 'none');
  const matrix = qrMatrix(url), fingerprint = createHash('sha256').update(JSON.stringify(matrix)).digest('hex');
  // This fixture was decoded independently with jsQR; protect the encoder and
  // its input URL from regressions without a runtime/test network dependency.
  assert.equal(fingerprint, '90f1f2e889cd55fc88819aa5305ff946bb7d674e0ead59a561691d4515b12999');
  assert.equal(matrix.length % 4, 1); assert.ok(matrix.length >= 21); assert.ok(matrix.every(row => row.length === matrix.length));
  const svg = decodeURIComponent(qrSvgDataUrl(url).split(',')[1]); assert.match(svg, /viewBox=/); assert.ok(!svg.includes(url), 'QR image does not embed arbitrary link text into SVG markup');
  if (process.env.BILLING_QR_DECODER) {
    const decode = require(resolve(process.env.BILLING_QR_DECODER));
    const scale = 6, width = (matrix.length + 8) * scale, pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    matrix.forEach((row, y) => row.forEach((black, x) => {if (black) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {const offset = (((y + 4) * scale + dy) * width + (x + 4) * scale + dx) * 4; pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;}}));
    assert.equal(decode(pixels, width, width)?.data, url, 'An independent QR decoder reads the exact protected document URL');
    console.log('Independent QR decode passed; fixture fingerprint:', fingerprint);
  }
  const data = structuredClone(documentExampleData); data.verification = {code: request.documentHash, url};
  const manual = new jsPDF({unit: 'mm', format: 'a4', compress: false});
  renderDocumentPdf(manual, defaultServiceRequestLayout, data);
  assert.equal(manual.getNumberOfPages(), 1, 'A normal manual form fits one A4 page');
  assert.ok(!manual.output().includes('/Subtype /Image'), 'No PNG is required to print the manual form');
  const long = structuredClone(data);
  long.items = Array.from({length: 50}, (_, i) => ({description: `ROW_${i} ` + 'Material longo e especificacao '.repeat(50), application: `MACHINE_${i}`}));
  long.items[49].description += ' UNIQUE_TAIL_MARKER';
  long.fields.notes = 'Observacao '.repeat(350) + ' NOTES_END_MARKER';
  const document = new jsPDF({unit: 'mm', format: 'a4', compress: false});
  const result = renderDocumentPdf(document, defaultServiceRequestLayout, long);
  assert.ok(result.overflowCount >= 2); assert.ok(document.getNumberOfPages() > 1);
  assert.ok(document.output().includes('UNIQUE_TAIL_MARKER'), 'The final service item survives page overflow');
  assert.ok(document.output().includes('NOTES_END_MARKER'), 'Long notes survive page overflow');
  for(let index=0;index<50;index++){
    assert.ok(document.output().includes(`ROW_${index} `),`Service ${index} survives tabular pagination`);
    assert.ok(document.output().includes(`MACHINE_${index}`),`Application ${index} remains in its own column`);
  }
  for(let page=2;page<=document.getNumberOfPages();page++){
    const content=document.internal.pages[page].join('\n');
    if(content.includes('ROW_')||content.includes('MACHINE_'))assert.ok(content.includes('Equipamento / material / servi'),'Continuation pages retain table headings');
  }
  const rowsData=structuredClone(data);
  rowsData.items=Array.from({length:24},(_,index)=>({description:`ROW_START_${index} ${'Descricao de material e servico '.repeat(6)} ROW_END_${index}`,application:`Aplicacao ${index}`}));
  const rowsPdf=new jsPDF({unit:'mm',format:'a4',compress:false});
  renderDocumentPdf(rowsPdf,defaultServiceRequestLayout,rowsData,{},()=>DOCUMENT_BODY_TOP);
  for(let index=0;index<24;index++){
    const pages=rowsPdf.internal.pages.slice(1).map(content=>content.join('\n'));
    const first=pages.findIndex(content=>content.includes(`ROW_START_${index} `)),last=pages.findIndex(content=>content.includes(`ROW_END_${index})`));
    assert.ok(first>=0&&first===last,`A row that fits a page stays together: ${index}`);
  }
  const edited = structuredClone(legacyServiceRequestLayout);
  edited.blocks.find(block => block.id === 'title').text = 'CUSTOM_TEMPLATE_TITLE';
  edited.blocks.find(block => block.id === 'title').x = 20;
  const custom = new jsPDF({unit: 'mm', format: 'a4', compress: false}); renderDocumentPdf(custom, edited, data);
  assert.ok(custom.output().includes('CUSTOM_TEMPLATE_TITLE'), 'PDF uses the edited model text');
  const watermark = documentWatermark({orientation: 'landscape', portraitImageUrl: 'portrait.png', landscapeImageUrl: 'landscape.png', opacity: 23, size: 71});
  assert.deepEqual(watermark, {imageUrl: 'portrait.png', opacity: 23, size: 71}, 'A4 requests use portrait artwork even when settings last displayed landscape');
  assert.equal(documentWatermark({portraitImageUrl: null, landscapeImageUrl: 'landscape.png', opacity: 23, size: 71}).imageUrl, null, 'Do not stretch landscape artwork into the portrait document');
  const branded = new jsPDF({unit: 'mm', format: 'a4', compress: false});
  const image = {bytes: new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')), ratio: 1, format: 'PNG'};
  renderDocumentPdf(branded, defaultServiceRequestLayout, long, {}, () => drawReportPdfWatermark(branded, 210, 297, watermark, image));
  assert.ok(branded.getNumberOfPages() > 1);
  for (let page = 1; page <= branded.getNumberOfPages(); page++) {
    const content = branded.internal.pages[page].join('\n');
    assert.match(content, /\/I0 Do/, 'Each continuation page contains the configured image');
    assert.ok(content.indexOf('/I0 Do') < content.indexOf('BT'), 'Watermark is drawn behind text');
  }
  assert.match(branded.output(), /\/ca 0\.23/, 'Saved opacity is preserved in the PDF graphics state');
  const original=JSON.stringify(legacyServiceRequestLayout),layout=layoutWithReportHeader(legacyServiceRequestLayout);
  assert.equal(JSON.stringify(legacyServiceRequestLayout),original,'Historical snapshots remain unchanged');
  assert.deepEqual(layout,defaultServiceRequestLayout,'Only the exact original model adopts the refined presentation');
  const legacyNormalized={page:{width:210,height:297},blocks:legacyServiceRequestLayout.blocks.filter(block=>!['brand','title','top-rule'].includes(block.id)).map(block=>({...block,y:55+(block.y-24)*228/269,height:block.height*228/269}))};
  assert.deepEqual(layoutWithReportHeader(legacyNormalized),defaultServiceRequestLayout,'The previously normalized default adopts the same presentation');
  legacyNormalized.blocks.find(block=>block.id==='company').x+=1;
  assert.deepEqual(layoutWithReportHeader(legacyNormalized),legacyNormalized,'Even a small deliberate coordinate edit is preserved');
  assert.deepEqual(layoutWithReportHeader(layout),layout,'Opening or saving again does not shrink the layout');
  assert.ok(layout.blocks.every(block=>block.y>=DOCUMENT_BODY_TOP&&block.y+block.height<=DOCUMENT_BODY_BOTTOM),'Body fits below the standard header');
  assert.ok(layoutWithReportHeader(edited).blocks.some(block=>block.text==='CUSTOM_TEMPLATE_TITLE'),'Custom titles survive header integration');
  const customSnapshot=JSON.stringify(edited),adapted=layoutWithReportHeader(edited);
  assert.equal(JSON.stringify(edited),customSnapshot,'A custom legacy snapshot remains immutable');
  assert.ok(adapted.blocks.every(block=>block.y>=55&&block.y+block.height<=283),'Custom legacy content keeps the previous standard-header fitting behavior');
  assert.equal(adapted.blocks.find(block=>block.id==='title').text,'CUSTOM_TEMPLATE_TITLE');
  for(const example of [data,long]){
    const pdf=new jsPDF({unit:'mm',format:'a4',compress:false});
    renderDocumentPdf(pdf,defaultServiceRequestLayout,example,{},()=>{
      drawReportPdfWatermark(pdf,210,297,watermark,image);
      const bottom=drawReportPdfHeader({doc:pdf,pageWidth:210,margin:14,orientation:'portrait',settings:{variant:'detailed',logoAlignment:'left',showCnpj:true,showContact:true},company:{name:'HEADER_COMPANY',cnpj:'04773159000523',street:'Fixture street',number:'10',district:'Rural',city:'Fixture city',state:'SE',zipCode:'49950000',phone:'123456789',email:'fixture@example.invalid'},logo:image,title:'Service request'});
      assert.ok(bottom<DOCUMENT_BODY_TOP,'Configured header fits the reserved area');return DOCUMENT_BODY_TOP;
    });
    if(example===data)assert.equal(pdf.getNumberOfPages(),1,'Standard form still fits one page with full header');
    else {assert.ok(pdf.getNumberOfPages()>1);assert.ok(pdf.output().includes('UNIQUE_TAIL_MARKER'));assert.ok(pdf.output().includes('NOTES_END_MARKER'));}
    for(let page=1;page<=pdf.getNumberOfPages();page++){
      const content=pdf.internal.pages[page].join('\n');
      assert.equal(content.split('(HEADER_COMPANY)').length-1,1,'Exactly one configured header on every page');
      assert.equal(content.split('(CONTROLE DE FATURAMENTO)').length-1,1,'Stock template header does not duplicate standard branding');
    }
  }
  const signed=structuredClone(data);
  signed.signatures={requester:{name:'REQUESTER_NAME',timestamp:'18/09/2026 10:30:05',hash:'a'.repeat(64)},director:{name:'DIRECTOR_NAME',timestamp:'18/09/2026 11:12:34',hash:'b'.repeat(64)}};
  const signedPdf=new jsPDF({unit:'mm',format:'a4',compress:false});
  const signedResult=renderDocumentPdf(signedPdf,defaultServiceRequestLayout,signed,{requester:image,director:image},()=>DOCUMENT_BODY_TOP);
  assert.equal(signedResult.overflowCount,0,'Normal PNG signatures and hashes fit alongside the request');
  assert.equal(signedPdf.getNumberOfPages(),1,'Signed request content fits its original A4 sheet before audit');
  for(const name of ['REQUESTER_NAME','DIRECTOR_NAME'])assert.ok(signedPdf.output().includes(name));
  const tinyData=structuredClone(signed);
  tinyData.items=[{description:'TINY_SERVICE_MARKER',application:'TINY_APPLICATION_MARKER'}];
  const tinyLayout={page:{width:210,height:297},blocks:[
    {id:'tiny-text',type:'text',x:14,y:60,width:4,height:4,fontSize:8,text:'TINY_TEXT_MARKER'},
    {id:'tiny-items',type:'items',x:30,y:60,width:4,height:4,fontSize:8},
    {id:'tiny-signature',type:'signature',field:'requester',x:46,y:60,width:4,height:4,fontSize:8},
    {id:'tiny-qr',type:'verification',x:62,y:60,width:4,height:4,fontSize:8},
  ]};
  const tinySnapshot=JSON.stringify(tinyLayout),tinyPdf=new jsPDF({unit:'mm',format:'a4',compress:false});
  const tinyText=[],tinyRects=[],tinyLinks=[];
  const originalText=tinyPdf.text.bind(tinyPdf),originalRect=tinyPdf.rect.bind(tinyPdf),originalLink=tinyPdf.link.bind(tinyPdf);
  tinyPdf.text=(...args)=>{tinyText.push({page:tinyPdf.getCurrentPageInfo().pageNumber,args});return originalText(...args);};
  tinyPdf.rect=(...args)=>{tinyRects.push({page:tinyPdf.getCurrentPageInfo().pageNumber,args});return originalRect(...args);};
  tinyPdf.link=(...args)=>{tinyLinks.push({page:tinyPdf.getCurrentPageInfo().pageNumber,args});return originalLink(...args);};
  const tinyResult=renderDocumentPdf(tinyPdf,tinyLayout,tinyData,{requester:image});
  assert.equal(tinyResult.overflowCount,4,'Each undersized custom block moves intact to continuation');
  assert.equal(JSON.stringify(tinyLayout),tinySnapshot,'Small custom coordinates remain immutable');
  assert.equal(tinyText.filter(call=>call.page===1).length,0,'Neither content nor a too-wide hint escapes the tiny source blocks');
  assert.equal(tinyRects.filter(call=>call.page===1).length,0,'A table header or miniature QR is not painted outside its tiny block');
  for(const marker of ['TINY_TEXT_MARKER','TINY_SERVICE_MARKER','TINY_APPLICATION_MARKER','REQUESTER_NAME'])assert.ok(tinyPdf.output().includes(marker),`${marker} survives the continuation`);
  assert.ok(tinyLinks.length>0&&tinyLinks.every(call=>call.page>1&&call.args[2]>=20&&call.args[3]>=20),'The moved QR remains scannable at a useful physical size');
  for(const block of [
    {id:'short-table',type:'items',x:14,y:70,width:100,height:4,fontSize:9},
    {id:'narrow-table',type:'items',x:14,y:70,width:4,height:50,fontSize:9},
    {id:'short-signature',type:'signature',field:'requester',x:14,y:70,width:100,height:4,fontSize:9},
    {id:'narrow-qr',type:'verification',x:14,y:70,width:40,height:24,fontSize:8},
  ]){
    const pdf=new jsPDF({unit:'mm',format:'a4',compress:false}),calls=[],textMethod=pdf.text.bind(pdf);
    pdf.text=(...args)=>{if(pdf.getCurrentPageInfo().pageNumber===1)calls.push({args,width:pdf.getTextWidth(args[0])});return textMethod(...args);};
    assert.equal(renderDocumentPdf(pdf,{page:{width:210,height:297},blocks:[block]},tinyData,{requester:image}).overflowCount,1);
    for(const call of calls){assert.equal(call.args[0],'Ver complemento.');assert.ok(call.width<=block.width&&call.args[1]>=block.x&&call.args[2]>=block.y&&call.args[2]<=block.y+block.height,'Hints stay within the original geometry');}
  }
  const auditRequest={
    ...request,number:489,status:'approved',template:{name:'Service request',version:2},createdBy:{name:'OPERATOR_NAME',userId:'actor-owner'},createdAt:'2026-09-18T13:30:05Z',
    requester:{name:'REQUESTER_NAME',signaturePath:'signature.png',signatureHash:'a'.repeat(64)},decision:{name:'DIRECTOR_NAME',signaturePath:null,userId:'actor-director'},
    history:Array.from({length:40},(_,index)=>({action:'approved',actorName:`AUDIT_ACTOR_${index}`,at:'2026-09-18T13:30:05Z',actorId:`actor-${index}`,reason:`REASON_${index}`})),
    attachments:[{id:'budget-final',fileName:'BUDGET_FINAL.pdf'}],complements:[{version:1,actorName:'COMPLEMENT_ACTOR',at:'2026-09-18T15:30:05Z',serviceValue:'1300.00',returnDate:'2026-09-30',attachmentIds:['budget-final'],actorId:'actor-complement',hash:'c'.repeat(64)}],
  };
  const snapshot=JSON.stringify(auditRequest);
  drawRequestPdfAudit(signedPdf,auditRequest,signed,()=>{
    drawReportPdfHeader({doc:signedPdf,pageWidth:210,margin:14,orientation:'portrait',settings:{variant:'detailed',logoAlignment:'left',showCnpj:true,showContact:true},company:{name:'AUDIT_COMPANY'},logo:null,title:'Service request'});
    return DOCUMENT_BODY_TOP;
  });
  drawRequestPdfFooters(signedPdf,489);
  assert.equal(JSON.stringify(auditRequest),snapshot,'Audit presentation cannot modify signed data or complements');
  for(const marker of ['AUDIT_ACTOR_39','REASON_39','BUDGET_FINAL.pdf','COMPLEMENT_ACTOR',...['a','c'].map(letter=>letter.repeat(64))])assert.ok(signedPdf.output().includes(marker),`Audit retains ${marker}`);
  assert.ok(signedPdf.getNumberOfPages()>2,'Long audit history continues without truncation');
  for(let page=1;page<=signedPdf.getNumberOfPages();page++){
    const content=signedPdf.internal.pages[page].join('\n');
    assert.ok(content.includes(`gina ${page} de ${signedPdf.getNumberOfPages()}`),'Every page identifies its position in the whole PDF');
    if(page>1)assert.equal(content.split('(AUDIT_COMPANY)').length-1,1,'Every audit continuation repeats the company header');
  }
  console.log('Passed: refined manual/signed PDFs, standard header and footer on all pages, immutable custom layouts, tabular overflow, audit pagination, watermark, QR and hash verification.');
} finally {
  const absolute = resolve(directory); assert.ok(absolute.startsWith(resolve(tmpdir()) + '\\') || absolute.startsWith(resolve(tmpdir()) + '/'));
  await rm(absolute, {recursive: true, force: true});
}
