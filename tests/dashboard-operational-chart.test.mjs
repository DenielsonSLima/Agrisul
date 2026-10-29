import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../modules/resumo/utils/operationalChart.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {operationalChartRows}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('operation selects only the chosen server periods, preserving decimals and unknown ATR',()=>{
 const metrics={loadCount:1,loadedVolume:'123456789012345.123456',averageAtr:'123.456789',averageLoadVolume:'2',contractCount:1,farmCount:1,plotCount:0};
 const months=[{...metrics,month:'2026-09'}],days=[{...metrics,date:'2026-09-14',endDate:'2026-09-14'},{...metrics,date:'2026-09-15',endDate:'2026-09-15',averageAtr:''}],periods=[{...metrics,date:'2026-09-14',endDate:'2026-09-20'}];
 const before=structuredClone({months,days,periods});
 assert.deepEqual(operationalChartRows(months,days,'day').map(r=>r.key),['2026-09-14','2026-09-15']);
 assert.equal(operationalChartRows(months,days,'day')[0].loadedVolume,metrics.loadedVolume);
 assert.equal(operationalChartRows(months,days,'day')[1].averageAtr,'');
 assert.equal(operationalChartRows(months,days,'month')[0].key,'2026-09');
 for(const grouping of ['week','fortnight']){assert.equal(operationalChartRows(months,days,grouping,periods)[0].endDate,'2026-09-20');assert.deepEqual(operationalChartRows(months,days,grouping),[]);}
 assert.deepEqual(operationalChartRows(months,undefined,'day'),[]);assert.deepEqual(operationalChartRows(months,[],'day'),[]);
 assert.deepEqual({months,days,periods},before);
});
