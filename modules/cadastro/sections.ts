import {lazy} from "react";
import {Users,Tractor,FileText,ChartNoAxesCombined,Sprout,Shovel,Signature,Files,Wrench,PackageOpen,Truck,Tags,CreditCard} from "lucide-react";
const PrestadoresPage=lazy(()=>import('./prestadores/components/PrestadoresPage').then(module=>({default:module.PrestadoresPage})));
const ClientesPage=lazy(()=>import("./clientes/components/ClientesPage").then(module=>({default:module.ClientesPage})));
const AtrPage=lazy(()=>import("./atr/components/AtrPage").then(module=>({default:module.AtrPage})));
const FazendaPage=lazy(()=>import("./fazenda/components/FazendaPage").then(module=>({default:module.FazendaPage})));
const ContratosCadastroPage=lazy(()=>import("./contratos/components/ContratosCadastroPage").then(module=>({default:module.ContratosCadastroPage})));
const CategoriasPage=lazy(()=>import("./categorias/components/CategoriasPage").then(module=>({default:module.CategoriasPage})));
const MateriaisPage=lazy(()=>import("./materiais/components/MateriaisPage").then(module=>({default:module.MateriaisPage})));
const FrotaPage=lazy(()=>import("./frota/components/FrotaPage").then(module=>({default:module.FrotaPage})));
const FormasPagamentoPage=lazy(()=>import("./formas-pagamento/components/FormasPagamentoPage").then(module=>({default:module.FormasPagamentoPage})));
const CulturasPage=lazy(()=>import("./culturas/components/CulturasPage").then(module=>({default:module.CulturasPage})));
const TratosCulturaisPage=lazy(()=>import("./tratos-culturais/components/TratosCulturaisPage").then(module=>({default:module.TratosCulturaisPage})));
const AssinaturasPage=lazy(()=>import("./assinaturas/components/AssinaturasPage").then(module=>({default:module.AssinaturasPage})));
const ModelosDocumentosPage=lazy(()=>import("./modelos-documentos/components/ModelosDocumentosPage").then(module=>({default:module.ModelosDocumentosPage})));

export const cadastroSections = [
  {id:"clientes",name:"Clientes",href:"/cadastro?secao=clientes",icon:Users,component:ClientesPage},
  {id:"prestadores",name:"Prestador",href:"/cadastro?secao=prestadores",icon:Wrench,component:PrestadoresPage},
  {id:"atr",name:"ATR",href:"/cadastro?secao=atr",icon:ChartNoAxesCombined,component:AtrPage},
  {id:"fazenda",name:"Fazenda",href:"/cadastro?secao=fazenda",icon:Tractor,component:FazendaPage},
  {id:"contratos",name:"Tipos de contrato",href:"/cadastro?secao=contratos",icon:FileText,component:ContratosCadastroPage},
  {id:"categorias",name:"Categorias",href:"/cadastro?secao=categorias",icon:Tags,component:CategoriasPage},
  {id:"materiais",name:"Materiais",href:"/cadastro?secao=materiais",icon:PackageOpen,component:MateriaisPage},
  {id:"frota",name:"Frota",href:"/cadastro?secao=frota",icon:Truck,component:FrotaPage},
  {id:"formas-pagamento",name:"Formas de pagamento",href:"/cadastro?secao=formas-pagamento",icon:CreditCard,component:FormasPagamentoPage},
  {id:"culturas",name:"Culturas",href:"/cadastro?secao=culturas",icon:Sprout,component:CulturasPage},
  {id:"tratos-culturais",name:"Manejo",href:"/cadastro?secao=tratos-culturais",icon:Shovel,component:TratosCulturaisPage},
  {id:"assinaturas",name:"Assinaturas",href:"/cadastro?secao=assinaturas",icon:Signature,component:AssinaturasPage},
  {id:"modelos-documentos",name:"Modelos de documentos",href:"/cadastro?secao=modelos-documentos",icon:Files,component:ModelosDocumentosPage},
];
