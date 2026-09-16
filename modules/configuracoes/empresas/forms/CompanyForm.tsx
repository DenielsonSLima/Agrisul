import {useEffect,useRef,useState} from "react";
import NextImage from "next/image";
import {Search,Loader2,Check,Building2,MapPin,Phone,Save,ImagePlus,Trash2} from "lucide-react";
import {Field,Choice} from "@/shared/components/Common";
import {ModuleLink,useModuleNavigation} from "@/shared/navigation/ModuleNavigation";
import {notifications,useConfirmation} from "@/shared/feedback";
import type {Company,CompanyInput,CompanyLogoChange} from "../types";
import {normalizeCnpj,validCnpj,validateCompany} from "../utils/companyValidation";
import {companiesHref,companyHref} from "../utils/companyNavigation";
import {fetchCnpj} from "../services/companyApi";

const empty={cnpj:"",legalName:"",tradeName:"",street:"",number:"",complement:"",district:"",city:"",state:"",zipCode:"",phone:"",email:""};
const allowedImages=["image/png","image/jpeg","image/webp"];

export function CompanyForm({company,hasPrimary,onSave}:{
 company?:Company;
 hasPrimary:boolean;
 onSave:(data:CompanyInput,id:string|undefined,logo:CompanyLogoChange)=>Promise<{id:string}>;
}){
 const[data,setData]=useState<CompanyInput>({...empty,...company,isPrimary:company?.isPrimary||!hasPrimary});
 const[saving,setSaving]=useState(false);const[looking,setLooking]=useState(false);const[error,setError]=useState("");const[lookedUp,setLookedUp]=useState(false);const[lookupError,setLookupError]=useState("");
 const[logoFile,setLogoFile]=useState<File|null>(null);const[logoUrl,setLogoUrl]=useState<string|null>(company?.logoUrl??null);const[logoName,setLogoName]=useState(company?.logoName??"");const[removeLogo,setRemoveLogo]=useState(false);const[logoError,setLogoError]=useState("");const[processingLogo,setProcessingLogo]=useState(false);
 const request=useRef<AbortController|null>(null);const logoInput=useRef<HTMLInputElement>(null);const localLogoUrl=useRef<string|null>(null);const logoSelection=useRef(0);const{navigate}=useModuleNavigation();const confirm=useConfirmation();
 const releaseLogo=()=>{if(localLogoUrl.current)URL.revokeObjectURL(localLogoUrl.current);localLogoUrl.current=null;};
 useEffect(()=>()=>{request.current?.abort();logoSelection.current++;releaseLogo();},[]);
 const change=(key:keyof typeof empty,value:string)=>setData(previous=>({...previous,[key]:value}));
 const field=(key:keyof typeof empty,label:string,maxLength=150,required=false,type="text")=><Field label={label}><input name={key} value={data[key]} onChange={event=>change(key,event.target.value)} maxLength={maxLength} required={required} type={type}/></Field>;
 const consult=async()=>{setLookupError("");setLookedUp(false);const cnpj=normalizeCnpj(data.cnpj);if(!validCnpj(cnpj)){setLookupError("Informe um CNPJ válido com 14 caracteres.");return}request.current?.abort();const controller=new AbortController();request.current=controller;setLooking(true);try{const details=await fetchCnpj(cnpj,controller.signal);if(!controller.signal.aborted){setData(current=>({...current,...details}));setLookedUp(true)}}catch(error){if(!controller.signal.aborted)setLookupError((error as Error).message)}finally{if(!controller.signal.aborted)setLooking(false)}};
 const chooseLogo=async(file:File)=>{
  setLogoError("");
  if(!allowedImages.includes(file.type)||!file.size||file.size>3*1024*1024){setLogoError("Envie uma logo PNG, JPG ou WebP de até 3 MB.");return;}
  const token=++logoSelection.current;const url=URL.createObjectURL(file);setProcessingLogo(true);
  try{
   const image=new Image();image.src=url;await image.decode();
   if(token!==logoSelection.current){URL.revokeObjectURL(url);return;}
   if(image.naturalWidth*image.naturalHeight>25000000)throw new Error("A imagem é muito grande. Use uma versão com até 25 megapixels.");
   releaseLogo();localLogoUrl.current=url;setLogoFile(file);setLogoUrl(url);setLogoName(file.name);setRemoveLogo(false);
  }catch(error){URL.revokeObjectURL(url);if(token===logoSelection.current)setLogoError(error instanceof Error&&error.message.includes("megapixels")?error.message:"Não foi possível abrir essa imagem. Escolha outro arquivo.");}
  finally{if(token===logoSelection.current)setProcessingLogo(false);}
 };
 const clearLogo=()=>{logoSelection.current++;releaseLogo();setLogoFile(null);setLogoUrl(null);setLogoName("");setRemoveLogo(!!company?.logoKey);setProcessingLogo(false);setLogoError("");};
 const requestLogoRemoval=async()=>{const accepted=await confirm({title:"Remover logo da empresa?",description:"A logo deixará de aparecer no cadastro quando você salvar as alterações.",confirmLabel:"Remover logo",tone:"destructive"});if(accepted)clearLogo();};

 return <form className="client-form company-form-page" onSubmit={async event=>{
  event.preventDefault();if(looking||saving||processingLogo)return;setError("");
  try{
   const input=validateCompany(data);setSaving(true);
   const result=await onSave(input,company?.id,{file:logoFile,remove:removeLogo,previousKey:company?.logoKey??null});
   if(company)notifications.updated("Os dados e a logo da empresa foram atualizados.");else notifications.created("A empresa foi cadastrada no Supabase.");
   navigate(companyHref(result.id));
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }}>
  <section className="company-logo-section" aria-labelledby="company-logo-title"><div className={"company-logo-preview "+(logoUrl?"has-image":"")}>{logoUrl?<NextImage src={logoUrl} alt="Prévia da logo da empresa" width={92} height={92} unoptimized/>:<Building2 size={30} strokeWidth={1.5}/>}</div><div className="company-logo-copy"><h3 id="company-logo-title">Logo da empresa</h3><p>Exibida nos cartões e na identificação da empresa.</p>{logoName&&<span title={logoName}>{logoName}</span>}<div className="company-logo-actions"><input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Logo da empresa" disabled={saving||processingLogo} onChange={event=>{const file=event.target.files?.[0];if(file)void chooseLogo(file);event.target.value="";}}/><button type="button" className="btn" disabled={saving||processingLogo} onClick={()=>logoInput.current?.click()}><ImagePlus size={16}/>{processingLogo?"Abrindo…":logoUrl?"Trocar logo":"Adicionar logo"}</button>{logoUrl&&<button type="button" className="btn company-logo-remove" disabled={saving||processingLogo} onClick={()=>{void requestLogoRemoval();}}><Trash2 size={15}/>Remover</button>}</div><small>PNG, JPG ou WebP · até 3 MB</small></div></section>
  {logoError&&<p className="form-error" role="alert">{logoError}</p>}
  <div className="cnpj-lookup-panel"><label htmlFor="company-cnpj">CNPJ da empresa</label><div className="cnpj-lookup-row"><input id="company-cnpj" name="cnpj" value={data.cnpj} maxLength={18} placeholder="00.000.000/0000-00" autoComplete="off" disabled={saving||looking} onChange={event=>{change("cnpj",event.target.value.toUpperCase());setLookedUp(false);setLookupError("")}}/><button type="button" className="btn company-primary" onClick={consult} disabled={saving||looking||!data.cnpj.trim()}>{looking?<Loader2 size={16} className="animate-spin"/>:<Search size={16}/>} {looking?"Consultando…":"Consultar CNPJ"}</button></div><p className="field-help">Consulta gratuita em bases públicas. Revise os dados antes de salvar.</p>
  {looking&&<p role="status" className="field-help">Buscando os dados da empresa…</p>}{lookedUp&&<p className="lookup-success" role="status"><Check size={15}/>Dados preenchidos. Revise antes de cadastrar.</p>}{lookupError&&<p className="form-error" role="alert">{lookupError}</p>}</div>
  <fieldset disabled={saving||looking} className="company-fieldset">
   <section className="client-form-section"><h3><Building2 size={17}/>Identificação</h3>{field("legalName","Razão social",200,true)}<div className="form-grid">{field("tradeName","Nome fantasia",200)}<Field label="Tipo"><Choice label="Tipo de empresa" value={data.isPrimary?"principal":"unidade"} onChange={value=>setData(current=>({...current,isPrimary:value==="principal"}))} items={(hasPrimary?["principal","unidade"]:["principal"]).map(value=>({value,label:value==="principal"?"Empresa principal":"Outra unidade"}))}/></Field></div>{!hasPrimary&&<p className="field-help">O primeiro cadastro será a empresa principal.</p>}{data.isPrimary&&hasPrimary&&!company?.isPrimary&&<p className="field-help">Ao salvar, a principal atual passa a ser uma unidade.</p>}</section>
   <section className="client-form-section"><h3><MapPin size={17}/>Endereço</h3><div className="form-grid client-street-grid">{field("street","Logradouro",200)}{field("number","Número",30)}</div><div className="form-grid">{field("complement","Complemento",150)}{field("district","Bairro",100)}</div><div className="form-grid client-city-grid">{field("city","Cidade",100)}{field("state","UF",2)}{field("zipCode","CEP",9)}</div></section>
   <section className="client-form-section"><h3><Phone size={17}/>Contato</h3><div className="form-grid">{field("phone","Telefone",40,false,"tel")}{field("email","E-mail",150,false,"email")}</div></section>
  </fieldset>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="form-actions"><ModuleLink href={companiesHref} className="btn" aria-disabled={saving} onClick={event=>{if(saving)event.preventDefault();}}>Cancelar</ModuleLink><button className="btn company-primary" disabled={saving||looking||processingLogo}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?"Salvando…":company?"Salvar alterações":"Cadastrar empresa"}</button></div>
 </form>;
}
