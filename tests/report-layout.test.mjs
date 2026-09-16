import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'report-layout-'));
try{
 const output=join(directory,'report-layout.mjs');
 await build({entryPoints:['shared/reporting/reportLayout.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
 const layout=await import(pathToFileURL(output));
 assert.deepEqual(layout.getReportPageSize('portrait'),{widthMm:210,heightMm:297});
 assert.deepEqual(layout.getReportPageSize('landscape'),{widthMm:297,heightMm:210});
 assert.deepEqual(layout.getReportWatermarkFrame(210,297,100),{x:0,y:0,width:210,height:297});
 assert.deepEqual(layout.getReportWatermarkFrame(297,210,100),{x:0,y:0,width:297,height:210});
 assert.deepEqual(layout.getReportWatermarkFrame(210,297,60),{x:42,y:59.400000000000006,width:126,height:178.2});
 assert.equal(layout.getReportOpacity(27),.27);
 assert.equal(layout.REPORT_MARGIN_MM,14);
 assert.equal(layout.REPORT_HEADER_METRICS.detailed.logoWidthMm,23);
 assert.equal(layout.REPORT_HEADER_METRICS.detailed.logoHeightMm,19);
 assert.equal(layout.REPORT_HEADER_METRICS.detailed.titlePt,11.5);
 const css=await readFile('app/globals.css','utf8');
 assert.match(css,/width:var\(--report-page-width\)!important;height:var\(--report-page-height\)/);
 assert.match(css,/\.report-document-content\{inset:var\(--report-margin\)\}/);
 assert.match(css,/\.wm-paper\.portrait\{width:210mm;max-width:none;height:297mm/);
 console.log('Passed: physical A4 preview, shared margins, watermark size and opacity geometry.');
}finally{await rm(directory,{recursive:true,force:true});}
