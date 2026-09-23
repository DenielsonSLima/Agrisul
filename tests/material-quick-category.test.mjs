import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {sortCategoriesAlphabetically} from '../modules/cadastro/categorias/categoryOrdering.ts';
import {mutationResources} from '../shared/query/derivedResources.ts';

const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));

test('categories are always presented in Portuguese alphabetical order', () => {
  const categories = [
    {id: '6', name: 'Parafuso'},
    {id: '5', name: 'óleo'},
    {id: '4', name: 'Filtro 10'},
    {id: '3', name: 'Água'},
    {id: '2', name: 'Filtro 2'},
    {id: '1', name: 'Abracadeiras'},
  ];

  assert.deepEqual(
    sortCategoriesAlphabetically(categories).map(category => category.name),
    ['Abracadeiras', 'Água', 'Filtro 2', 'Filtro 10', 'óleo', 'Parafuso'],
  );
  assert.deepEqual(
    categories.map(category => category.name),
    ['Parafuso', 'óleo', 'Filtro 10', 'Água', 'Filtro 2', 'Abracadeiras'],
    'sorting the presentation must not mutate the remote query cache',
  );
});

test('quick category creation uses the material-categories RPC contract', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'material-quick-category-'));
  const output = join(directory, 'category-api.mjs');
  const calls = [];
  const savedCategory = {
    id: 'category-new',
    name: 'Filtros',
    createdAt: '2026-09-23T12:00:00.000Z',
    updatedAt: '2026-09-23T12:00:00.000Z',
  };

  t.after(async () => {
    delete globalThis.materialCategoryRpcFixture;
    await rm(directory, {recursive: true, force: true});
  });

  globalThis.materialCategoryRpcFixture = async (...args) => {
    calls.push(args);
    return {category: savedCategory};
  };

  const rpcFixture = {
    name: 'material-category-rpc-fixture',
    setup(builder) {
      builder.onResolve(
        {filter: /shared\/supabase\/rpc$/},
        () => ({path: 'rpc', namespace: 'fixture'}),
      );
      builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({
        contents: 'export const rpcRequest=(...args)=>globalThis.materialCategoryRpcFixture(...args);',
      }));
    },
  };

  await build({
    entryPoints: ['modules/cadastro/categorias/services/categoryApi.ts'],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [rpcFixture],
  });

  const {persistMaterialCategory} = await import(pathToFileURL(output));
  const input = {name: 'Filtros'};
  assert.deepEqual(await persistMaterialCategory(input), savedCategory);
  assert.deepEqual(calls, [['material-categories', 'save', input]]);
  assert.deepEqual(
    mutationResources('material-categories'),
    ['material-categories', 'materials'],
    'saving a category must refresh both option and material projections',
  );
});

test('material form keeps its draft mounted and selects a category created in place', async () => {
  const [materialsSource, categoryFormSource] = await Promise.all([
    readFile(
      new URL('../modules/cadastro/materiais/components/MateriaisPage.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../modules/cadastro/categorias/components/CategoryForm.tsx', import.meta.url),
      'utf8',
    ),
  ]);
  const start = materialsSource.indexOf('function MaterialForm(');
  const end = materialsSource.indexOf('function ReferenceForm(', start);
  assert.notEqual(start, -1, 'MaterialForm must exist');
  assert.notEqual(end, -1, 'MaterialForm boundary must remain detectable');
  const materialForm = materialsSource.slice(start, end);

  assert.match(materialsSource, /useMaterialCategoryMutations/);
  assert.match(materialsSource, /import \{CategoryForm\}/);
  assert.match(materialForm, /const \[form,setForm\]=useState<MaterialInput>/);
  assert.match(materialForm, /const \[file,setFile\]=useState<File\|null>\(null\)/);
  assert.match(materialForm, /const \[categoryOpen,setCategoryOpen\]=useState\(false\)/);
  assert.match(
    materialForm,
    /<button type="button"[^>]*aria-label="Cadastrar nova categoria"[^>]*onClick=\{\(\)=>setCategoryOpen\(true\)\}/,
    'the plus action must be accessible and must not submit the material form',
  );
  assert.match(
    materialForm,
    /<\/form>\s*\{categoryOpen&&<CategoryForm/,
    'the category dialog must be a sibling while the controlled material form stays mounted',
  );
  assert.doesNotMatch(materialForm, /<CategoryForm[^>]*\bkey=/);

  const saveCategoryAt = materialForm.indexOf('const saved=await categoryMutations.save(input);');
  const retainOptionAt = materialForm.indexOf('setCreatedCategories(', saveCategoryAt);
  const selectCategoryAt = materialForm.indexOf('categoryId:saved.id', retainOptionAt);
  const successAt = materialForm.indexOf('notifications.created(', selectCategoryAt);
  const closeAt = materialForm.indexOf('setCategoryOpen(false)', successAt);
  assert.ok(saveCategoryAt >= 0, 'the category mutation must be awaited');
  assert.ok(retainOptionAt > saveCategoryAt, 'the returned option must remain available after refetch');
  assert.ok(selectCategoryAt > retainOptionAt, 'the returned category id must become the draft selection');
  assert.ok(successAt > selectCategoryAt, 'success feedback must describe the selected saved category');
  assert.ok(closeAt > successAt, 'the nested dialog closes only after save, selection and feedback');

  assert.match(categoryFormSource, /event\.preventDefault\(\)/);
  assert.match(categoryFormSource, /const normalizedName = name\.trim\(\)/);
  assert.match(categoryFormSource, /await onSave\(\{id: category\?\.id, name: normalizedName\}\)/);
  assert.match(categoryFormSource, /setError\(message\)[\s\S]*notifications\.error\(message\)/);
  assert.match(categoryFormSource, /className="form-error" role="alert"/);
  assert.match(categoryFormSource, /<fieldset disabled=\{saving\}>/);
});
