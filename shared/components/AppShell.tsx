"use client";
import {lazy,Suspense,useEffect,useState} from "react";
import {ModuleLink as Link,ModuleNavigationProvider,useModuleNavigation} from "@/shared/navigation/ModuleNavigation";
import {Home,Users,FileText,LayoutDashboard,CalendarDays,Settings,Search,ChevronRight,ReceiptText,FileChartColumn,ClipboardCheck,Wrench,Loader2,ShoppingCart,ShoppingBag,FolderOpen,Clock3,ShieldAlert} from "lucide-react";
import {SidebarProvider,Sidebar,SidebarHeader,SidebarContent,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarMenuSub,SidebarMenuSubItem,SidebarMenuSubButton,SidebarTrigger,useSidebar} from "@/components/ui/sidebar";
import {Dialog,DialogContent,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {Command,CommandInput,CommandList,CommandEmpty,CommandGroup,CommandItem} from "@/components/ui/command";
import {useApp} from "@/shared/state/AppProvider";
import {initials} from "@/shared/utils/format";
import {SessionButton} from "@/shared/supabase/SessionButton";
import {cadastroSections} from "@/modules/cadastro/sections";
import {configuracoesSections} from "@/modules/configuracoes/sections";
import {Choice} from "@/shared/components/Common";
import {useWorkspaceCompany} from "@/shared/state/WorkspaceCompanyProvider";
import {useWorkspaceAccess,type WorkspacePermissions} from "@/shared/access/useWorkspaceAccess";
import {canOpenWorkspaceHref,workspaceLandingHref} from "@/shared/access/routeAccess";
const InicioPage=lazy(()=>import("@/modules/inicio/components/InicioPage").then(module=>({default:module.InicioPage})));
const CadastroPage=lazy(()=>import("@/modules/cadastro/components/CadastroPage").then(module=>({default:module.CadastroPage})));
const SolicitacoesPage=lazy(()=>import("@/modules/solicitacoes/components/SolicitacoesPage").then(module=>({default:module.SolicitacoesPage})));
const CotacaoPage=lazy(()=>import("@/modules/cotacao/components/CotacaoPage").then(module=>({default:module.CotacaoPage})));
const PedidosPage=lazy(()=>import("@/modules/pedidos/components/PedidosPage").then(module=>({default:module.PedidosPage})));
const DocumentacaoPage=lazy(()=>import("@/modules/documentacao/components/DocumentacaoPage").then(module=>({default:module.DocumentacaoPage})));
const ContratosPage=lazy(()=>import("@/modules/contratos/components/ContratosPage").then(module=>({default:module.ContratosPage})));
const ImportacoesPage=lazy(()=>import("@/modules/importacoes/components/ImportacoesPage").then(module=>({default:module.ImportacoesPage})));
const DashboardPage=lazy(()=>import("@/modules/resumo/components/ResumoPage").then(module=>({default:module.ResumoPage})));
const AgendaPage=lazy(()=>import("@/modules/agenda/components/AgendaPage").then(module=>({default:module.AgendaPage})));
const RelatoriosPage=lazy(()=>import("@/modules/relatorios/components/RelatoriosPage").then(module=>({default:module.RelatoriosPage})));
const ConfiguracoesPage=lazy(()=>import("@/modules/configuracoes/components/ConfiguracoesPage").then(module=>({default:module.ConfiguracoesPage})));
const modules=[{path:"/",name:"Início",icon:Home,component:InicioPage},{path:"/dashboard",name:"Dashboard",icon:LayoutDashboard,component:DashboardPage},{path:"/cadastro",name:"Cadastros",icon:Users,component:CadastroPage},{path:"/solicitacoes",name:"Solicitações",icon:ClipboardCheck,component:SolicitacoesPage},{path:"/cotacao",name:"Cotação",icon:ReceiptText,component:CotacaoPage},{path:"/pedidos",name:"Pedidos",icon:ShoppingCart,component:PedidosPage},{path:"/documentacao",name:"Documentação",icon:FolderOpen,component:DocumentacaoPage},{path:"/contratos",name:"Contratos",icon:FileText,component:ContratosPage},{path:"/importacoes",name:"Importações PDF / Excel",icon:FileText,component:ImportacoesPage},{path:"/agenda",name:"Agenda",icon:CalendarDays,component:AgendaPage},{path:"/relatorios",name:"Relatórios",icon:FileChartColumn,component:RelatoriosPage},{path:"/configuracoes",name:"Configurações",icon:Settings,component:ConfiguracoesPage}];
const solicitacoesSections=[{id:"horas-extras",name:"Relatório de hora extra",href:"/solicitacoes?secao=horas-extras",icon:Clock3},{id:"servico",name:"Serviço",href:"/solicitacoes?secao=servico",icon:Wrench},{id:"compras",name:"Compras",href:"/solicitacoes?secao=compras",icon:ShoppingBag},{id:"cotacao",name:"Cotação",href:"/cotacao",icon:ReceiptText},{id:"pedidos",name:"Pedidos",href:"/pedidos",icon:ShoppingCart}];
function Navigation({access}:{access:WorkspacePermissions}){
 const {pathname:path,searchParams}=useModuleNavigation();
 const canOpen=(href:string)=>canOpenWorkspaceHref(access,href);
 const availableCadastros=cadastroSections.filter(section=>canOpen(section.href));
 const selectedCadastro=path==="/cadastro"?(availableCadastros.find(s=>s.id===searchParams.get("secao"))??availableCadastros[0]):undefined;
 const cadastroActive=path==="/cadastro";
 const [expanded,setExpanded]=useState<Record<string,boolean>>({});
 const m=useApp(),{setOpenMobile}=useSidebar();
 const home=workspaceLandingHref(access)??'/configuracoes?secao=perfil';
 return <Sidebar className="app-sidebar">
  <SidebarHeader className="brand-header"><Link href={home} className="brand"><span className="brand-mark" aria-hidden="true"><ReceiptText size={23} strokeWidth={1.7}/></span><span className="system-brand">Controle de<br/>Faturamento</span></Link><span className="brand-caption"/></SidebarHeader>
  <SidebarContent><div className="nav-label">PRINCIPAL</div><SidebarMenu className="main-nav">
   {modules.filter(x=>x.path!=="/configuracoes"&&x.path!=="/cotacao"&&x.path!=="/pedidos").filter(x=>canOpen(x.path)).map(x=>{
    const grouped=x.path==="/cadastro"||x.path==="/solicitacoes";
    const sections=(x.path==="/cadastro"?cadastroSections:solicitacoesSections).filter(section=>canOpen(section.href));
    const groupActive=x.path==="/solicitacoes"?["/solicitacoes","/cotacao","/pedidos"].includes(path):path===x.path;
    const groupExpanded=grouped&&!!expanded[x.path],subnavId=`sidebar-subnav-${x.path.slice(1)}`;
    return <SidebarMenuItem key={x.path}>
     <SidebarMenuButton asChild={!grouped} type={grouped?"button":undefined} isActive={groupActive} className="nav-item" aria-expanded={grouped?groupExpanded:undefined} aria-controls={grouped?subnavId:undefined} onClick={grouped?()=>setExpanded(current=>({...current,[x.path]:!current[x.path]})):undefined}>
      {grouped?<><x.icon/><span>{x.name}</span><ChevronRight className={"cadastro-toggle-chevron "+(groupExpanded?"expanded":"")} aria-hidden="true"/></>:<Link href={x.path} aria-current={path===x.path?"page":undefined} onClick={()=>setOpenMobile(false)}><x.icon/><span>{x.name}</span></Link>}
     </SidebarMenuButton>
     {grouped&&<div id={subnavId} className="sidebar-subnav-motion" data-open={groupExpanded?"true":"false"} aria-hidden={!groupExpanded} inert={!groupExpanded}><div className="sidebar-subnav-clip"><SidebarMenuSub className="cadastro-subnav" aria-label={"Submódulos de "+x.name}>
      {sections.map(item=>{const active=x.path==="/cadastro"?cadastroActive&&selectedCadastro?.id===item.id:item.id==="cotacao"?path==="/cotacao":item.id==="pedidos"?path==="/pedidos":path==="/solicitacoes"&&searchParams.get("secao")===item.id;return <SidebarMenuSubItem key={item.id}><SidebarMenuSubButton asChild isActive={active} className="cadastro-subnav-link"><Link href={item.href} aria-current={active?"page":undefined} onClick={()=>setOpenMobile(false)}><item.icon/><span>{item.name}</span></Link></SidebarMenuSubButton></SidebarMenuSubItem>;})}
     </SidebarMenuSub></div></div>}
    </SidebarMenuItem>;
   })}
  </SidebarMenu>{canOpen('/configuracoes')&&<><div className="nav-label management-label">GERENCIAMENTO</div><SidebarMenu className="main-nav"><SidebarMenuItem><SidebarMenuButton asChild isActive={path==="/configuracoes"} className="nav-item"><Link href="/configuracoes" aria-current={path==="/configuracoes"?"page":undefined} onClick={()=>setOpenMobile(false)}><Settings/><span>Configurações</span></Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu></>}</SidebarContent>
  <SidebarFooter className="sidebar-bottom"><Link href="/configuracoes?secao=perfil" className="user-profile"><span className="user-avatar">{initials(m.settings.name)}</span><div><strong>{m.settings.name}</strong><small>Minha conta</small></div><ChevronRight size={16}/></Link></SidebarFooter>
 </Sidebar>;
}
export function AppShell({initialHref="/"}:{initialHref?:string}){return <ModuleNavigationProvider initialHref={initialHref}><WorkspaceShell/></ModuleNavigationProvider>}
function WorkspaceShell(){
 const access=useWorkspaceAccess();
 if(access.loading)return <div className="client-loading" role="status"><Loader2 className="animate-spin" size={20}/>Carregando permissões…</div>;
 if(access.error||!access.data)return <div className="company-empty" role="alert"><ShieldAlert/><h1>Não foi possível conferir seu acesso</h1><p>{access.error||'As permissões não estão disponíveis.'}</p><button className="btn" onClick={()=>void access.reload()}>Tentar novamente</button><SessionButton/></div>;
 return <AuthorizedWorkspaceShell access={access.data}/>;
}
function AuthorizedWorkspaceShell({access}:{access:WorkspacePermissions}){
 const {pathname:path,searchParams,navigate}=useModuleNavigation(),m=useApp(),workspace=useWorkspaceCompany();
 const [search,setSearch]=useState(false),canOpen=(href:string)=>canOpenWorkspaceHref(access,href);
 const selectedCadastro=path==="/cadastro"?(cadastroSections.find(s=>s.id===searchParams.get("secao"))??cadastroSections.find(s=>canOpen(s.href))):undefined;
 const selectedConfiguracao=path==="/configuracoes"?configuracoesSections.find(s=>s.id===searchParams.get("secao")):undefined;
 const current=modules.find(x=>x.path===path),Page=current?.component;
 const href=path+(searchParams.toString()?'?'+searchParams.toString():''),allowed=canOpen(href),landing=workspaceLandingHref(access);
 useEffect(()=>{if(path==='/'&&!allowed&&landing)navigate(landing,{replace:true});},[path,allowed,landing,navigate]);
 useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key==="k"){event.preventDefault();setSearch(value=>!value);}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);},[]);
 function go(url:string){if(canOpen(url)){setSearch(false);navigate(url);}}
 const availableModules=modules.filter(x=>x.path!=="/cotacao"&&x.path!=="/pedidos"&&canOpen(x.path));
 const requests=solicitacoesSections.filter(section=>canOpen(section.href)),cadastros=cadastroSections.filter(section=>canOpen(section.href));
 const configurations=configuracoesSections.filter(section=>canOpen('/configuracoes?secao='+section.id));
 return <SidebarProvider style={{"--sidebar-width":"244px"} as React.CSSProperties}><Navigation access={access}/><div className={"app-main "+(m.settings.compact?"compact":"")}>
  <header className="topbar"><div className="breadcrumbs"><SidebarTrigger aria-label="Alternar menu lateral" className="sidebar-toggle"/><span className="breadcrumb-home">Espaço de trabalho</span><ChevronRight size={14}/><strong>{selectedCadastro?"Cadastros / "+selectedCadastro.name:selectedConfiguracao?"Configurações / "+selectedConfiguracao.title:path==="/solicitacoes"&&searchParams.get("secao")==="horas-extras"?"Solicitações / Relatório de hora extra":path==="/solicitacoes"&&searchParams.get("secao")==="servico"?"Solicitações / Serviço":path==="/solicitacoes"&&searchParams.get("secao")==="compras"?"Solicitações / Compras":path==="/cotacao"?"Solicitações / Cotação":path==="/pedidos"?"Solicitações / Pedidos":current?.name||"Página"}</strong></div>
  {workspace.companies.length>1&&<div className="top-company-switch"><span>Empresa</span><Choice label="Alterar empresa ativa" value={workspace.activeCompanyId} onChange={workspace.selectCompany} items={workspace.companies.map(company=>({value:company.id,label:company.name}))}/></div>}<button className="global-search" onClick={()=>setSearch(true)}><Search size={17}/><span>Buscar em todo o sistema...</span><kbd>⌘ K</kbd></button><Link href="/configuracoes?secao=perfil" className="top-avatar" aria-label="Meu perfil">{initials(m.settings.name)}</Link><SessionButton/></header>
  <main className="page-content">{Page?allowed?<Suspense fallback={<div className="client-loading" role="status"><Loader2 className="animate-spin" size={20}/>Carregando módulo…</div>}><Page key={(current?.path??'')+':'+workspace.activeCompanyId}/></Suspense>:<div className="company-empty" role="alert"><ShieldAlert/><h1>Acesso não permitido</h1><p>Seu perfil não tem acesso a este módulo.</p>{landing&&<Link href={landing} className="btn">Abrir meus módulos</Link>}</div>:<div className="empty"><h1>Página não encontrada</h1>{landing&&<Link href={landing} className="text-link">Abrir meus módulos</Link>}</div>}<footer className="page-footer"><span>Controle de Faturamento</span></footer></main>
 </div><Dialog open={search} onOpenChange={setSearch}><DialogContent className="search-modal"><DialogTitle className="sr-only">Busca global</DialogTitle><DialogDescription className="sr-only">Encontre e abra os módulos disponíveis para seu perfil.</DialogDescription><Command><CommandInput placeholder="O que você procura?"/><CommandList><CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
 {availableModules.length>0&&<CommandGroup heading="Módulos">{availableModules.map(x=><CommandItem key={x.path} onSelect={()=>go(x.path)}><x.icon/>{x.name}</CommandItem>)}</CommandGroup>}
 {requests.length>0&&<CommandGroup heading="Solicitações">{requests.map(section=><CommandItem key={section.id} value={"Solicitações "+section.name} onSelect={()=>go(section.href)}><section.icon/>{section.name}</CommandItem>)}</CommandGroup>}
 {cadastros.length>0&&<CommandGroup heading="Cadastros">{cadastros.map(section=><CommandItem key={section.id} value={"Cadastros "+section.name} onSelect={()=>go(section.href)}><section.icon/>{section.name}</CommandItem>)}</CommandGroup>}
 {configurations.length>0&&<CommandGroup heading="Configurações">{configurations.map(section=><CommandItem key={section.id} value={"Configurações "+section.title} onSelect={()=>go("/configuracoes?secao="+section.id)}><section.icon/>{section.title}</CommandItem>)}</CommandGroup>}
 </CommandList></Command></DialogContent></Dialog></SidebarProvider>;
}
