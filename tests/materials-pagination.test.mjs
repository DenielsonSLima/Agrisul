import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  MATERIALS_PAGE_SIZE,
  paginateMaterials,
  parseMaterialsPage,
} from '../modules/cadastro/materiais/materialsPagination.ts';

test('materiais usa exatamente 30 registros por página e limita páginas inválidas',()=>{
  const materials=Array.from({length:65},(_,index)=>({id:String(index+1)}));

  assert.equal(MATERIALS_PAGE_SIZE,30);
  assert.deepEqual(paginateMaterials(materials,1).items.map(item=>item.id),materials.slice(0,30).map(item=>item.id));

  const second=paginateMaterials(materials,2);
  assert.equal(second.items.length,30);
  assert.equal(second.firstItem,31);
  assert.equal(second.lastItem,60);
  assert.equal(second.totalPages,3);
  assert.equal(second.hasPrevious,true);
  assert.equal(second.hasNext,true);

  const last=paginateMaterials(materials,999);
  assert.equal(last.page,3);
  assert.equal(last.items.length,5);
  assert.equal(last.firstItem,61);
  assert.equal(last.lastItem,65);
  assert.equal(last.hasNext,false);
});

test('página da URL é validada e coleção vazia permanece estável',()=>{
  assert.equal(parseMaterialsPage(null),1);
  assert.equal(parseMaterialsPage('0'),1);
  assert.equal(parseMaterialsPage('-2'),1);
  assert.equal(parseMaterialsPage('abc'),1);
  assert.equal(parseMaterialsPage('2'),2);

  assert.deepEqual(paginateMaterials([],3),{
    items:[],page:1,pageSize:30,total:0,totalPages:1,
    firstItem:0,lastItem:0,hasPrevious:false,hasNext:false,
  });
});

test('tela preserva a página na URL, reseta ao filtrar e oferece navegação acessível',async()=>{
  const source=await readFile(new URL('../modules/cadastro/materiais/components/MateriaisPage.tsx',import.meta.url),'utf8');

  assert.match(source,/parseMaterialsPage\(searchParams\.get\('pagina'\)\)/);
  assert.match(source,/busca:value\|\|null,material:null,pagina:null/);
  assert.match(source,/categoria:value==='all'\?null:value,material:null,pagina:null/);
  assert.match(source,/aria-label="Paginação dos materiais"/);
  assert.match(source,/aria-label="Página anterior"/);
  assert.match(source,/aria-label="Próxima página"/);
  assert.match(source,/pagination\.pageSize} por página/);
});
