import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('load dialog opens an accessible in-place farm and optional plot registration', async () => {
  const [loadDialog,quickOrigin,plotHook]=await Promise.all([
    readFile(new URL('../modules/contratos/components/details/ContractLoadDialog.tsx',import.meta.url),'utf8'),
    readFile(new URL('../modules/contratos/components/details/QuickOriginDialog.tsx',import.meta.url),'utf8'),
    readFile(new URL('../modules/cadastro/talhoes/hooks/usePlots.ts',import.meta.url),'utf8'),
  ]);

  assert.match(loadDialog,/type="button"[^>]*className="btn contract-origin-add"[^>]*aria-label="Cadastrar nova fazenda e talhão"/);
  assert.match(loadDialog,/<\/form>\s*\{originOpen&&<QuickOriginDialog/,'the load draft must stay mounted behind the nested dialog');
  assert.match(loadDialog,/farmId:farm\.id,plotId:plot\?\.id\?\?''/,'the newly persisted origin must be selected');

  assert.match(quickOrigin,/O talhão é opcional/);
  assert.match(quickOrigin,/checked=\{includePlot\}/);
  assert.match(quickOrigin,/\{includePlot&&<fieldset/,'plot fields must only be required when the optional section is enabled');
  assert.match(quickOrigin,/onPointerDownOutside=\{event=>event\.preventDefault\(\)\}/);
  assert.doesNotMatch(quickOrigin,/Ã|â€¦/,'new user-facing copy must be valid UTF-8');

  const saveFarmAt=quickOrigin.indexOf('persistedFarm=await farms.save(farm)');
  const selectFarmAt=quickOrigin.indexOf('onCreated({farm:persistedFarm})',saveFarmAt);
  const savePlotAt=quickOrigin.indexOf('await plots.save(persistedFarm.id,plot)',selectFarmAt);
  const selectOriginAt=quickOrigin.indexOf('onCreated({farm:persistedFarm,plot:persistedPlot})',savePlotAt);
  const successAt=quickOrigin.indexOf('notifications.created(',selectOriginAt);
  const closeAt=quickOrigin.indexOf('onClose()',successAt);
  assert.ok(saveFarmAt>=0&&selectFarmAt>saveFarmAt,'farm persistence must finish before selection');
  assert.ok(savePlotAt>selectFarmAt,'optional plot persistence must use the saved farm id');
  assert.ok(selectOriginAt>savePlotAt,'the optional saved plot must be selected');
  assert.ok(successAt>selectOriginAt&&closeAt>successAt,'success feedback and closing happen only after persistence, invalidation and selection');

  assert.match(plotHook,/export function usePlotsMutation\(\)/);
  assert.match(plotHook,/persistPlot\(farmId,input,id\)/);
  assert.match(plotHook,/\['farms','contracts'\]/,'saving a plot must invalidate its related projections');
});
