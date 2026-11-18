'use client';
/* Product photos are private signed assets optimized in the browser. */
/* eslint-disable @next/next/no-img-element */

import {useEffect,useMemo,useRef,useState} from 'react';
import {ImageOff,ImagePlus,Loader2,Plus,Save} from 'lucide-react';
import {Choice,Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {CategoryForm} from '@/modules/cadastro/categorias/components/CategoryForm';
import {sortCategoriesAlphabetically} from '@/modules/cadastro/categorias/categoryOrdering';
import {useMaterialCategoryMutations} from '@/modules/cadastro/categorias/hooks/useMaterialCategories';
import type {MaterialCategory} from '@/modules/cadastro/categorias/types';
import type {Material,MaterialImageChange,MaterialInput} from '@/modules/cotacao/types';
import {formatImageSize,optimizeMaterialImage} from '../utils/optimizeMaterialImage';
import '../styles.css';

const NO_CATEGORY='__no_category__';
const emptyMaterial:MaterialInput={name:'',internalCode:'',categoryId:null,unit:'',application:''};
type MaterialCategoryOption=Pick<MaterialCategory,'id'|'name'>;

export function MaterialForm({material,initialName='',categories,categoriesLoading,categoriesError,saving,onBusy,onClose,onSave}:{material?:Material;initialName?:string;categories:MaterialCategoryOption[];categoriesLoading:boolean;categoriesError:string;saving:boolean;onBusy:(value:boolean)=>void;onClose:()=>void;onSave:(input:MaterialInput,image?:MaterialImageChange)=>Promise<void>}){
 const [form,setForm]=useState<MaterialInput>(material?{id:material.id,name:material.name,internalCode:material.internalCode,categoryId:material.categoryId,unit:material.unit,application:material.application}:{...emptyMaterial,name:initialName});
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
      <Choice label="Categoria do material" value={form.categoryId??NO_CATEGORY} onChange={value=>{if(!value)return;setForm(current=>({...current,categoryId:value===NO_CATEGORY?null:value}));setError('');}} disabled={categoriesLoading&&!categoryOptions.length} items={[{value:NO_CATEGORY,label:'Sem categoria'},...categoryOptions.map(category=>({value:category.id,label:category.name}))]}/>
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
