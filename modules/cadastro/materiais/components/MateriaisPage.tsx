'use client';
/* Product photos are private signed assets optimized in the browser. */
/* eslint-disable @next/next/no-img-element */

import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ChevronLeft,ChevronRight,ClipboardList,FileText,FolderTree,ImageOff,ImagePlus,Loader2,Pencil,Plus,RefreshCw,Save,Search,Tag,Trash2} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Choice,Field} from '@/shared/components/Common';
import {notifications,useConfirmation} from '@/shared/feedback';
import {ModuleLink,useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {CategoryForm} from '@/modules/cadastro/categorias/components/CategoryForm';
import {compareCategoryNames,sortCategoriesAlphabetically} from '@/modules/cadastro/categorias/categoryOrdering';
import {useMaterialCategories,useMaterialCategoryMutations} from '@/modules/cadastro/categorias/hooks/useMaterialCategories';
import type {MaterialCategory} from '@/modules/cadastro/categorias/types';
import {useMaterialMutations,useMaterials} from '@/modules/cotacao/hooks/useQuotes';
import type {Material,MaterialImageChange,MaterialInput,MaterialReference,MaterialReferenceInput} from '@/modules/cotacao/types';
import {paginateMaterials,parseMaterialsPage,type MaterialsPagination} from '../materialsPagination';
import {formatImageSize,optimizeMaterialImage} from '../utils/optimizeMaterialImage';
import '../styles.css';

const NO_CATEGORY='__no_category__';
const emptyMaterial:MaterialInput={name:'',internalCode:'',categoryId:null,unit:'',application:''};

type MaterialGroup={id:string;name:string;items:Material[]};
type MaterialCategoryOption=Pick<MaterialCategory,'id'|'name'>;

function groupMaterials(items:Material[],categories:MaterialCategoryOption[]):MaterialGroup[]{
 const names=new Map(categories.map(category=>[category.id,category.name]));
 const grouped=new Map<string,MaterialGroup>();
 items.forEach(item=>{
  const id=item.categoryId??NO_CATEGORY;
  const name=id===NO_CATEGORY?'Sem categoria':item.categoryName||names.get(id)||'Categoria';
  const group=grouped.get(id)??{id,name,items:[]};
  group.items.push(item);grouped.set(id,group);
 });
 return [...grouped.values()].map(group=>({...group,items:[...group.items].sort((left,right)=>left.name.localeCompare(right.name,'pt-BR'))})).sort((left,right)=>left.id===right.id?0:left.id===NO_CATEGORY?1:right.id===NO_CATEGORY?-1:compareCategoryNames(left.name,right.name));
}

export function MateriaisPage(){
 const materialsQuery=useMaterials();
 const categoriesQuery=useMaterialCategories();
 const mutations=useMaterialMutations();
 const confirm=useConfirmation();
 const {navigate,searchParams}=useModuleNavigation();
 const [materialOpen,setMaterialOpen]=useState(false);
 const [editMaterial,setEditMaterial]=useState<Material>();
 const [referenceOpen,setReferenceOpen]=useState(false);
 const [editReference,setEditReference]=useState<MaterialReference>();
 const [busy,setBusy]=useState(false);
 const detailId=searchParams.get('material');
 const search=searchParams.get('busca')??'';
 const categoryFilter=searchParams.get('categoria')??'all';
 const requestedPage=parseMaterialsPage(searchParams.get('pagina'));
 const detail=materialsQuery.materials.find(item=>item.id===detailId)??null;

 const locationHref=(changes:Record<string,string|null>)=>{
  const params=new URLSearchParams(searchParams.toString());
  params.set('secao','materiais');
  Object.entries(changes).forEach(([key,value])=>{if(value)params.set(key,value);else params.delete(key);});
  return `/cadastro?${params.toString()}`;
 };
 const listHref=locationHref({material:null});
 const categories=useMemo<MaterialCategoryOption[]>(()=>{
  const byId=new Map<string,MaterialCategoryOption>(categoriesQuery.categories.map(category=>[category.id,{id:category.id,name:category.name}]));
  materialsQuery.materials.forEach(material=>{if(material.categoryId&&!byId.has(material.categoryId))byId.set(material.categoryId,{id:material.categoryId,name:material.categoryName||'Categoria'});});
  return sortCategoriesAlphabetically([...byId.values()]);
 },[categoriesQuery.categories,materialsQuery.materials]);
 const filtered=useMemo(()=>{
  const value=search.trim().toLocaleLowerCase('pt-BR');
  return materialsQuery.materials.filter(item=>{
   const inCategory=categoryFilter==='all'||(categoryFilter===NO_CATEGORY?!item.categoryId:item.categoryId===categoryFilter);
   const searchable=`${item.name} ${item.internalCode} ${item.categoryName} ${item.application} ${item.references.map(reference=>`${reference.brand} ${reference.code}`).join(' ')}`.toLocaleLowerCase('pt-BR');
   return inCategory&&(!value||searchable.includes(value));
  });
 },[categoryFilter,materialsQuery.materials,search]);
 const orderedGroups=useMemo(()=>groupMaterials(filtered,categories),[categories,filtered]);
 const orderedFiltered=useMemo(()=>orderedGroups.flatMap(group=>group.items),[orderedGroups]);
 const pagination=useMemo(()=>paginateMaterials(orderedFiltered,requestedPage),[orderedFiltered,requestedPage]);
 const groups=useMemo(()=>groupMaterials(pagination.items,categories),[categories,pagination.items]);

 useEffect(()=>{
  if(detailId||materialsQuery.loading||materialsQuery.error)return;
  const normalized=pagination.page>1?String(pagination.page):null;
  if(searchParams.get('pagina')===normalized)return;
  const params=new URLSearchParams(searchParams.toString());
  params.set('secao','materiais');
  if(normalized)params.set('pagina',normalized);else params.delete('pagina');
  navigate(`/cadastro?${params.toString()}`,{replace:true});
 },[detailId,materialsQuery.error,materialsQuery.loading,navigate,pagination.page,searchParams]);

 const setSearch=(value:string)=>navigate(locationHref({busca:value||null,material:null,pagina:null}),{replace:true});
 const setCategoryFilter=(value:string)=>navigate(locationHref({categoria:value==='all'?null:value,material:null,pagina:null}),{replace:true});
 const clearFilters=()=>navigate(locationHref({busca:null,categoria:null,material:null,pagina:null}),{replace:true});
 const setPage=(page:number)=>navigate(locationHref({pagina:page>1?String(page):null,material:null}),{replace:true});
 const openDetail=(id:string)=>navigate(locationHref({material:id}));
 const beginMaterial=(item?:Material)=>{setEditMaterial(item);setBusy(false);setMaterialOpen(true);};
 const beginReference=(item?:MaterialReference)=>{setEditReference(item);setBusy(false);setReferenceOpen(true);};
 const removeMaterial=async(item:Material)=>{
  const accepted=await confirm({title:'Excluir material?',description:`O produto “${item.name}”, sua foto e suas ${item.references.length} referência(s) serão removidos. Materiais usados em cotações permanecem protegidos.`,confirmLabel:'Excluir',tone:'destructive'});
  if(!accepted)return;
  try{
   await mutations.remove(item.id);
   if(detailId===item.id)navigate(listHref,{replace:true});
   notifications.deleted('Material removido.');
  }catch(reason){notifications.error((reason as Error).message||'Não foi possível excluir o material.');}
 };
 const removeReference=async(item:MaterialReference)=>{
  const label=[item.brand,item.code].filter(Boolean).join(' ');
  const accepted=await confirm({title:'Excluir referência?',description:`A referência “${label}” será removida deste produto.`,confirmLabel:'Excluir',tone:'destructive'});
  if(!accepted)return;
  try{await mutations.removeReference(item.id);notifications.deleted('Referência removida.');}
  catch(reason){notifications.error((reason as Error).message||'Não foi possível excluir a referência.');}
 };

 return <section className="materials-workspace">
  {detailId
   ?materialsQuery.loading?<MaterialLoading backHref={listHref}/>:materialsQuery.error?<MaterialLoadError message={materialsQuery.error} backHref={listHref} onReload={materialsQuery.reload}/>:detail?<MaterialDetail material={detail} backHref={listHref} busy={busy||mutations.saving} onEdit={()=>beginMaterial(detail)} onDelete={()=>void removeMaterial(detail)} onAddReference={()=>beginReference()} onEditReference={beginReference} onDeleteReference={item=>void removeReference(item)}/>:<MaterialNotFound backHref={listHref}/>
   :<MaterialList materials={materialsQuery.materials} filtered={filtered} groups={groups} pagination={pagination} categories={categories} loading={materialsQuery.loading} error={materialsQuery.error} categoriesError={categoriesQuery.error} search={search} categoryFilter={categoryFilter} onSearch={setSearch} onCategory={setCategoryFilter} onPage={setPage} onClearFilters={clearFilters} onReload={materialsQuery.reload} onReloadCategories={categoriesQuery.reload} onCreate={()=>beginMaterial()} onOpen={openDetail} onEdit={beginMaterial} onDelete={item=>void removeMaterial(item)} onQuotes={()=>navigate('/cotacao')}/>} 

  <Dialog open={materialOpen} onOpenChange={value=>{if(!busy)setMaterialOpen(value);}}><DialogContent className="form-modal material-modal" showCloseButton={!busy} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}><DialogHeader><DialogTitle>{editMaterial?'Editar material':'Cadastrar material'}</DialogTitle><DialogDescription>Informe os dados, a categoria opcional e a foto única do produto. As referências equivalentes são adicionadas na tela do material.</DialogDescription></DialogHeader><MaterialForm material={editMaterial} categories={categories} categoriesLoading={categoriesQuery.loading} categoriesError={categoriesQuery.error} saving={busy} onBusy={setBusy} onClose={()=>{setBusy(false);setMaterialOpen(false);}} onSave={async(input,image)=>{const editing=!!editMaterial;const saved=await mutations.save(input,image);notifications[editing?'updated':'created'](editing?'Material atualizado com sucesso.':'Material criado. Agora adicione as referências equivalentes.');if(!editing)navigate(locationHref({material:saved.id}));}}/></DialogContent></Dialog>

  <Dialog open={referenceOpen} onOpenChange={value=>{if(!busy)setReferenceOpen(value);}}><DialogContent className="form-modal material-reference-modal" showCloseButton={!busy} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}><DialogHeader><DialogTitle>{editReference?'Editar referência':'Adicionar referência'}</DialogTitle><DialogDescription>{detail?`${detail.name}: informe a marca e o código equivalente.`:'Informe a marca e o código equivalente.'}</DialogDescription></DialogHeader>{detail&&<ReferenceForm material={detail} reference={editReference} saving={busy} onBusy={setBusy} onClose={()=>{setBusy(false);setReferenceOpen(false);}} onSave={async input=>{await mutations.saveReference(input);notifications[editReference?'updated':'created'](editReference?'Referência atualizada com sucesso.':'Referência adicionada com sucesso.');}}/>}</DialogContent></Dialog>
 </section>;
}

type MaterialListProps={materials:Material[];filtered:Material[];groups:MaterialGroup[];pagination:MaterialsPagination<Material>;categories:MaterialCategoryOption[];loading:boolean;error:string;categoriesError:string;search:string;categoryFilter:string;onSearch:(value:string)=>void;onCategory:(value:string)=>void;onPage:(page:number)=>void;onClearFilters:()=>void;onReload:()=>Promise<void>;onReloadCategories:()=>Promise<void>;onCreate:()=>void;onOpen:(id:string)=>void;onEdit:(item:Material)=>void;onDelete:(item:Material)=>void;onQuotes:()=>void};

function MaterialList({materials,filtered,groups,pagination,categories,loading,error,categoriesError,search,categoryFilter,onSearch,onCategory,onPage,onClearFilters,onReload,onReloadCategories,onCreate,onOpen,onEdit,onDelete,onQuotes}:MaterialListProps){
 return <>
  <nav className="client-breadcrumb farm-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><span aria-hidden="true">›</span><span aria-current="page">Materiais</span></nav>
  <div className="companies-heading"><div><h2>Materiais</h2><p>Produtos organizados por categoria, com foto e referências equivalentes.</p></div><div className="farm-heading-actions"><button type="button" className="btn" onClick={onQuotes}><FileText size={17}/>Cotações</button><button type="button" className="btn company-primary" onClick={onCreate}><Plus size={17}/>Cadastrar material</button></div></div>
  {!loading&&!error&&!!materials.length&&<div className="materials-toolbar"><label className="local-search"><Search size={16}/><span className="sr-only">Buscar material</span><input value={search} onChange={event=>onSearch(event.target.value)} placeholder="Buscar produto, código ou referência…"/></label><label className="material-category-filter"><span>Categoria</span><select value={categoryFilter} onChange={event=>onCategory(event.target.value)}><option value="all">Todas as categorias</option>{categories.map(category=><option value={category.id} key={category.id}>{category.name}</option>)}<option value={NO_CATEGORY}>Sem categoria</option></select></label><span className="materials-result-count">{filtered.length} de {materials.length}</span></div>}
  {categoriesError&&!loading&&!error&&<div className="material-category-warning" role="status"><span>Não foi possível atualizar a lista de categorias.</span><button type="button" onClick={()=>void onReloadCategories()}><RefreshCw size={13}/>Tentar novamente</button></div>}
  {loading?<div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando materiais…</div>:error?<div className="company-empty" role="alert"><h3>Não foi possível carregar</h3><p>{error}</p><button type="button" className="btn" onClick={()=>void onReload()}><RefreshCw size={16}/>Tentar novamente</button></div>:!materials.length?<div className="company-empty"><span className="company-empty-icon"><ClipboardList size={25}/></span><h3>Cadastre seu primeiro material</h3><p>O produto terá uma única foto e poderá receber várias referências equivalentes.</p><button type="button" className="btn company-primary" onClick={onCreate}><Plus size={16}/>Cadastrar material</button></div>:!filtered.length?<div className="company-empty"><span className="company-empty-icon"><Search size={25}/></span><h3>Nenhum material encontrado</h3><p>Ajuste a busca ou o filtro de categoria.</p><button type="button" className="btn" onClick={onClearFilters}>Limpar filtros</button></div>:<div className="materials-table-shell"><table className="materials-table"><thead><tr><th scope="col">Material</th><th scope="col">Código interno</th><th scope="col">Unidade</th><th scope="col">Referências</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>{groups.map(group=><tbody key={group.id}><tr className="material-category-row"><th colSpan={5} scope="rowgroup"><span><FolderTree size={15}/>{group.name}</span><small>{group.items.length} materia{group.items.length===1?'l':'is'} nesta página</small></th></tr>{group.items.map(item=><tr className="material-table-row" key={item.id} role="link" tabIndex={0} aria-label={`Abrir material ${item.name}`} onClick={()=>onOpen(item.id)} onKeyDown={event=>{if(event.target===event.currentTarget&&event.key==='Enter'){event.preventDefault();onOpen(item.id);}}}><td><div className="material-table-product"><span className="material-table-photo">{item.imageUrl?<img src={item.imageUrl} alt="" loading="lazy"/>:<ClipboardList size={20}/>}</span><span><strong>{item.name}</strong><small>{item.application||item.categoryName||'Sem descrição informada'}</small></span></div></td><td><code>{item.internalCode||'—'}</code></td><td>{item.unit}</td><td><div className="material-table-references"><strong><Tag size={13}/>{item.references.length}</strong>{item.references.length>0&&<small>{item.references.slice(0,2).map(reference=>reference.code).join(' · ')}{item.references.length>2?` +${item.references.length-2}`:''}</small>}</div></td><td><div className="material-table-actions"><button type="button" className="icon-btn" aria-label={`Editar ${item.name}`} onClick={event=>{event.stopPropagation();onEdit(item);}}><Pencil size={15}/></button><button type="button" className="icon-btn" aria-label={`Excluir ${item.name}`} onClick={event=>{event.stopPropagation();onDelete(item);}}><Trash2 size={15}/></button><ChevronRight size={17} aria-hidden="true"/></div></td></tr>)}</tbody>)}</table></div>}
  {!loading&&!error&&!!filtered.length&&<MaterialsPaginationNav pagination={pagination} onPage={onPage}/>} 
 </>;
}

function MaterialsPaginationNav({pagination,onPage}:{pagination:MaterialsPagination<Material>;onPage:(page:number)=>void}){
 return <nav className="materials-pagination" aria-label="Paginação dos materiais"><span aria-live="polite"><strong>{pagination.firstItem}–{pagination.lastItem}</strong> de {pagination.total} materiais <small>· {pagination.pageSize} por página</small></span><div><button type="button" className="btn" disabled={!pagination.hasPrevious} onClick={()=>onPage(pagination.page-1)} aria-label="Página anterior"><ChevronLeft size={16}/>Anterior</button><span>Página <strong>{pagination.page}</strong> de {pagination.totalPages}</span><button type="button" className="btn" disabled={!pagination.hasNext} onClick={()=>onPage(pagination.page+1)} aria-label="Próxima página">Próxima<ChevronRight size={16}/></button></div></nav>;
}

function MaterialDetail({material,backHref,busy,onEdit,onDelete,onAddReference,onEditReference,onDeleteReference}:{material:Material;backHref:string;busy:boolean;onEdit:()=>void;onDelete:()=>void;onAddReference:()=>void;onEditReference:(item:MaterialReference)=>void;onDeleteReference:(item:MaterialReference)=>void}){
 return <div className="material-detail-page">
  <div className="client-navigation"><nav className="client-breadcrumb" aria-label="Navegação estrutural"><ModuleLink href="/cadastro">Cadastros</ModuleLink><ChevronRight size={14}/><ModuleLink href={backHref}>Materiais</ModuleLink><ChevronRight size={14}/><span aria-current="page">{material.name}</span></nav><ModuleLink className="client-back" href={backHref}><ArrowLeft size={15}/>Voltar aos materiais</ModuleLink></div>
  <div className="companies-heading material-detail-heading"><div><span className="quote-eyebrow">{material.categoryName||'SEM CATEGORIA'}</span><h2>{material.name}</h2><p>Foto, dados do produto e referências equivalentes.</p></div><div className="farm-heading-actions"><button type="button" className="btn" disabled={busy} onClick={onEdit}><Pencil size={16}/>Editar material</button><button type="button" className="btn danger" disabled={busy} onClick={onDelete}><Trash2 size={16}/>Excluir</button></div></div>
  <div className="material-detail"><section className="material-product-summary"><div className="material-product-photo">{material.imageUrl?<img src={material.imageUrl} alt={`Foto de ${material.name}`}/>:<ImageOff size={38}/>}</div><div className="material-product-content"><span>PRODUTO</span><h3>{material.name}</h3><p>{material.application||'Aplicação/descrição não informada'}</p><dl><div><dt>Categoria</dt><dd><FolderTree size={14}/>{material.categoryName||'Sem categoria'}</dd></div><div><dt>Código interno</dt><dd>{material.internalCode||'Não informado'}</dd></div><div><dt>Unidade</dt><dd>{material.unit}</dd></div></dl></div></section><section><div className="material-detail-toolbar"><div><span>Referências equivalentes</span><strong>{material.references.length} cadastrada(s)</strong></div><button type="button" className="btn company-primary" disabled={busy} onClick={onAddReference}><Plus size={16}/>Adicionar referência</button></div>{!material.references.length?<div className="company-empty material-variant-empty"><Tag size={26}/><h3>Nenhuma referência cadastrada</h3><p>Adicione os códigos equivalentes de cada marca ou fabricante.</p><button type="button" className="btn company-primary" disabled={busy} onClick={onAddReference}><Plus size={16}/>Adicionar referência</button></div>:<div className="material-reference-table" role="table" aria-label="Referências equivalentes"><div className="material-reference-head" role="row"><span role="columnheader">Marca / fabricante</span><span role="columnheader">Código da referência</span><span aria-hidden="true"/></div>{material.references.map(reference=><div className="material-reference-row" role="row" key={reference.id}><strong role="cell">{reference.brand||'Sem marca informada'}</strong><code role="cell">{reference.code}</code><div className="material-variant-actions" role="cell"><button type="button" className="icon-btn" disabled={busy} aria-label={`Editar referência ${reference.code}`} onClick={()=>onEditReference(reference)}><Pencil size={16}/></button><button type="button" className="icon-btn" disabled={busy} aria-label={`Excluir referência ${reference.code}`} onClick={()=>onDeleteReference(reference)}><Trash2 size={16}/></button></div></div>)}</div>}</section></div>
 </div>;
}

function MaterialLoading({backHref}:{backHref:string}){return <><MaterialDetailBreadcrumb backHref={backHref}/><div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando material…</div></>;}
function MaterialLoadError({message,backHref,onReload}:{message:string;backHref:string;onReload:()=>Promise<void>}){return <><MaterialDetailBreadcrumb backHref={backHref}/><div className="company-empty" role="alert"><h3>Não foi possível carregar o material</h3><p>{message}</p><div className="inline-actions"><button type="button" className="btn" onClick={()=>void onReload()}><RefreshCw size={16}/>Tentar novamente</button><ModuleLink className="btn" href={backHref}>Voltar</ModuleLink></div></div></>;}
function MaterialNotFound({backHref}:{backHref:string}){return <><MaterialDetailBreadcrumb backHref={backHref}/><div className="company-empty" role="alert"><h3>Material não encontrado</h3><p>O produto pode ter sido removido ou não pertence a este espaço.</p><ModuleLink className="btn" href={backHref}><ArrowLeft size={16}/>Voltar aos materiais</ModuleLink></div></>;}
function MaterialDetailBreadcrumb({backHref}:{backHref:string}){return <div className="client-navigation"><nav className="client-breadcrumb" aria-label="Navegação estrutural"><ModuleLink href="/cadastro">Cadastros</ModuleLink><ChevronRight size={14}/><ModuleLink href={backHref}>Materiais</ModuleLink><ChevronRight size={14}/><span aria-current="page">Detalhes</span></nav><ModuleLink className="client-back" href={backHref}><ArrowLeft size={15}/>Voltar aos materiais</ModuleLink></div>;}

function MaterialForm({material,categories,categoriesLoading,categoriesError,saving,onBusy,onClose,onSave}:{material?:Material;categories:MaterialCategoryOption[];categoriesLoading:boolean;categoriesError:string;saving:boolean;onBusy:(value:boolean)=>void;onClose:()=>void;onSave:(input:MaterialInput,image?:MaterialImageChange)=>Promise<void>}){
 const [form,setForm]=useState<MaterialInput>(material?{id:material.id,name:material.name,internalCode:material.internalCode,categoryId:material.categoryId,unit:material.unit,application:material.application}:emptyMaterial);
 const [error,setError]=useState('');
 const [file,setFile]=useState<File|null>(null);
 const [removeImage,setRemoveImage]=useState(false);
 const [preview,setPreview]=useState<string|null>(material?.imageUrl??null);
 const [imageInfo,setImageInfo]=useState(material?.imageName??'');
 const [categoryOpen,setCategoryOpen]=useState(false);
 const [createdCategories,setCreatedCategories]=useState<MaterialCategoryOption[]>([]);
 const categoryMutations=useMaterialCategoryMutations();
 const localUrl=useRef<string|null>(null),inputRef=useRef<HTMLInputElement>(null);
 const categoryOptions=useMemo(()=>{
  const byId=new Map(categories.map(category=>[category.id,category]));
  createdCategories.forEach(category=>byId.set(category.id,category));
  return sortCategoriesAlphabetically([...byId.values()]);
 },[categories,createdCategories]);
 useEffect(()=>()=>{if(localUrl.current)URL.revokeObjectURL(localUrl.current);},[]);
 const change=(key:'name'|'internalCode'|'unit'|'application',value:string)=>{setForm(current=>({...current,[key]:value}));setError('');};
 const choose=async(source?:File)=>{if(!source)return;setError('');onBusy(true);try{const optimized=await optimizeMaterialImage(source);if(localUrl.current)URL.revokeObjectURL(localUrl.current);const url=URL.createObjectURL(optimized);localUrl.current=url;setFile(optimized);setRemoveImage(false);setPreview(url);setImageInfo(`${optimized.name} · ${formatImageSize(optimized.size)} (original ${formatImageSize(source.size)})`);}catch(reason){const message=(reason as Error).message||'Não foi possível processar a foto.';setError(message);notifications.error(message);}finally{onBusy(false);if(inputRef.current)inputRef.current.value='';}};
 const clearImage=()=>{if(localUrl.current){URL.revokeObjectURL(localUrl.current);localUrl.current=null;}setFile(null);setRemoveImage(!!material?.imageKey);setPreview(null);setImageInfo('');setError('');};
 const submit=async(event:React.FormEvent)=>{event.preventDefault();if(!form.name.trim()||!form.unit.trim()){setError('Preencha o nome e a unidade do material.');return;}onBusy(true);setError('');try{const image=file||removeImage?{file,remove:removeImage,previousKey:material?.imageKey??null}:undefined;await onSave({...form,categoryId:form.categoryId||null},image);onClose();}catch(reason){const message=(reason as Error).message||'Não foi possível salvar o material.';setError(message);notifications.error(message);onBusy(false);}};
 return <>
  <form className="material-form" onSubmit={event=>void submit(event)} aria-busy={saving}>
   <fieldset disabled={saving}>
    <div className="material-photo-field"><div className="material-photo-preview">{preview?<img src={preview} alt="Prévia da foto do produto"/>:<ImagePlus size={30}/>}</div><div><strong>Foto do produto <span>(opcional e única)</span></strong><p>Esta foto representa o produto e será compartilhada por todas as referências. PNG, JPG ou WebP de até 12 MB.</p>{imageInfo&&<small>{imageInfo}</small>}<div className="material-photo-actions"><input ref={inputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>void choose(event.target.files?.[0])}/><button type="button" className="btn" onClick={()=>inputRef.current?.click()}><ImagePlus size={16}/>{preview?'Trocar foto':'Escolher foto'}</button>{preview&&<button type="button" className="btn" onClick={clearImage}><ImageOff size={16}/>Remover</button>}</div></div></div>
    <Field label="Nome do produto *"><input autoFocus value={form.name} maxLength={150} onChange={event=>change('name',event.target.value)} placeholder="Ex.: Filtro hidráulico"/></Field>
    <div className="field material-category-field">
     <span>Categoria (opcional)</span>
     <div className="material-category-input">
      <Choice label="Categoria do material" value={form.categoryId??NO_CATEGORY} onChange={value=>{setForm(current=>({...current,categoryId:value===NO_CATEGORY?null:value}));setError('');}} disabled={categoriesLoading&&!categoryOptions.length} items={[{value:NO_CATEGORY,label:'Sem categoria'},...categoryOptions.map(category=>({value:category.id,label:category.name}))]}/>
      <button type="button" className="btn material-category-add" aria-label="Cadastrar nova categoria" title="Cadastrar nova categoria" onClick={()=>setCategoryOpen(true)}><Plus size={18}/></button>
     </div>
     {categoriesLoading&&<small className="material-field-help">Carregando categorias…</small>}
     {categoriesError&&<small className="material-field-help error">Não foi possível atualizar as categorias; você ainda pode cadastrar uma nova ou salvar sem categoria.</small>}
    </div>
    <Field label="Código interno (opcional)"><input value={form.internalCode} maxLength={60} onChange={event=>change('internalCode',event.target.value)} placeholder="Ex.: MAT-001"/></Field>
    <Field label="Unidade *"><input value={form.unit} maxLength={30} onChange={event=>change('unit',event.target.value)} placeholder="Ex.: PC"/></Field>
    <Field label="Aplicação / descrição (opcional)"><textarea rows={4} maxLength={1000} value={form.application} onChange={event=>change('application',event.target.value)} placeholder="Ex.: filtro hidráulico para a linha de equipamentos…"/></Field>
   </fieldset>
   {error&&<p className="form-error" role="alert">{error}</p>}
   <div className="form-actions"><button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="btn company-primary" disabled={saving}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?'Salvando…':material?'Salvar alterações':'Criar material'}</button></div>
  </form>
  {categoryOpen&&<CategoryForm onClose={()=>setCategoryOpen(false)} onSave={async input=>{
   onBusy(true);
   try{
    const saved=await categoryMutations.save(input);
    setCreatedCategories(current=>[...current.filter(category=>category.id!==saved.id),{id:saved.id,name:saved.name}]);
    setForm(current=>({...current,categoryId:saved.id}));
    setError('');
    notifications.created(`A categoria “${saved.name}” foi cadastrada e selecionada.`);
    setCategoryOpen(false);
    return saved;
   }finally{onBusy(false);}
  }}/>} 
 </>;
}

function ReferenceForm({material,reference,saving,onBusy,onClose,onSave}:{material:Material;reference?:MaterialReference;saving:boolean;onBusy:(value:boolean)=>void;onClose:()=>void;onSave:(input:MaterialReferenceInput)=>Promise<void>}){
 const [form,setForm]=useState<MaterialReferenceInput>({id:reference?.id,materialId:material.id,brand:reference?.brand??'',code:reference?.code??''}),[error,setError]=useState('');
 const change=(key:'brand'|'code',value:string)=>{setForm(current=>({...current,[key]:value}));setError('');};
 const submit=async(event:React.FormEvent)=>{event.preventDefault();if(!form.code.trim()){setError('Informe o código da referência.');return;}onBusy(true);setError('');try{await onSave(form);onClose();}catch(reason){const message=(reason as Error).message||'Não foi possível salvar a referência.';setError(message);notifications.error(message);onBusy(false);}};
 return <form className="material-form" onSubmit={event=>void submit(event)} aria-busy={saving}><fieldset disabled={saving}><Field label="Marca / fabricante (opcional)"><input autoFocus value={form.brand} maxLength={100} onChange={event=>change('brand',event.target.value)} placeholder="Ex.: MANN, Baldwin, Donaldson"/></Field><Field label="Código da referência *"><input value={form.code} maxLength={60} onChange={event=>change('code',event.target.value)} placeholder="Ex.: H601/10"/></Field></fieldset>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="btn company-primary" disabled={saving}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?'Salvando…':reference?'Salvar referência':'Adicionar referência'}</button></div></form>;
}
