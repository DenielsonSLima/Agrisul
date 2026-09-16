import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'farm-report-'));
try{
 const output=join(directory,'farm-report.mjs');
 await build({entryPoints:['modules/cadastro/fazenda/reporting/farmSummaryPdf.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
 const {createFarmSummaryPdf}=await import(pathToFileURL(output));
 const farms=Array.from({length:19},(_,index)=>({id:String(index),name:`Fazenda ${index+1}`,city:'Itabaiana',state:'SE',areaHa:'10',totalHa:'10',usedHa:'6',preservedHa:'4',usedPercent:60,plotCount:2,createdAt:'',updatedAt:''}));
 const summary={farmCount:19,plotCount:38,totalHa:'190',usedHa:'114',preservedHa:'76',usedPercent:60};
 const brand={orientation:'portrait',header:{variant:'detailed',logoAlignment:'left',showCnpj:true,showContact:true},company:null,watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'user',name:'Responsável',email:'responsavel@example.test'},issuedAt:new Date('2026-09-15T12:00:00Z')};
 const {doc,fileName}=await createFarmSummaryPdf(farms,summary,brand);
 const bytes=new Uint8Array(doc.output('arraybuffer'));
 assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'%PDF');
 assert.equal(doc.getNumberOfPages(),2);
 assert.equal(fileName,'resumo-fazendas-2026-09-15.pdf');
 console.log('Passed: downloadable farm PDF, portfolio totals and automatic pagination.');
}finally{await rm(directory,{recursive:true,force:true});}
