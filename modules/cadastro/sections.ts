import {Users,Tractor,FileText,ChartNoAxesCombined,Sprout,Shovel,Signature,Files,Wrench} from "lucide-react";
import {PrestadoresPage} from './prestadores/components/PrestadoresPage';
import {ClientesPage} from "./clientes/components/ClientesPage";
import {AtrPage} from "./atr/components/AtrPage";
import {FazendaPage} from "./fazenda/components/FazendaPage";
import {ContratosCadastroPage} from "./contratos/components/ContratosCadastroPage";

import {CulturasPage} from "./culturas/components/CulturasPage";
import {TratosCulturaisPage} from "./tratos-culturais/components/TratosCulturaisPage";
import {AssinaturasPage} from "./assinaturas/components/AssinaturasPage";
import {ModelosDocumentosPage} from "./modelos-documentos/components/ModelosDocumentosPage";

export const cadastroSections = [
  {id:"clientes",name:"Clientes",href:"/cadastro?secao=clientes",icon:Users,component:ClientesPage},
  {id:"prestadores",name:"Prestador",href:"/cadastro?secao=prestadores",icon:Wrench,component:PrestadoresPage},
  {id:"atr",name:"ATR",href:"/cadastro?secao=atr",icon:ChartNoAxesCombined,component:AtrPage},
  {id:"fazenda",name:"Fazenda",href:"/cadastro?secao=fazenda",icon:Tractor,component:FazendaPage},
  {id:"contratos",name:"Tipos de contrato",href:"/cadastro?secao=contratos",icon:FileText,component:ContratosCadastroPage},
  {id:"culturas",name:"Culturas",href:"/cadastro?secao=culturas",icon:Sprout,component:CulturasPage},
  {id:"tratos-culturais",name:"Manejo",href:"/cadastro?secao=tratos-culturais",icon:Shovel,component:TratosCulturaisPage},
  {id:"assinaturas",name:"Assinaturas",href:"/cadastro?secao=assinaturas",icon:Signature,component:AssinaturasPage},
  {id:"modelos-documentos",name:"Modelos de documentos",href:"/cadastro?secao=modelos-documentos",icon:Files,component:ModelosDocumentosPage},
];
