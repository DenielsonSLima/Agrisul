import {Users,Tractor,FileText,ChartNoAxesCombined,Sprout,Shovel} from "lucide-react";
import {ClientesPage} from "./clientes/components/ClientesPage";
import {AtrPage} from "./atr/components/AtrPage";
import {FazendaPage} from "./fazenda/components/FazendaPage";
import {ContratosCadastroPage} from "./contratos/components/ContratosCadastroPage";

import {CulturasPage} from "./culturas/components/CulturasPage";
import {TratosCulturaisPage} from "./tratos-culturais/components/TratosCulturaisPage";

export const cadastroSections = [
  {id:"clientes",name:"Clientes",href:"/cadastro?secao=clientes",icon:Users,component:ClientesPage},
  {id:"atr",name:"ATR",href:"/cadastro?secao=atr",icon:ChartNoAxesCombined,component:AtrPage},
  {id:"fazenda",name:"Fazenda",href:"/cadastro?secao=fazenda",icon:Tractor,component:FazendaPage},
  {id:"contratos",name:"Tipos de contrato",href:"/cadastro?secao=contratos",icon:FileText,component:ContratosCadastroPage},
  {id:"culturas",name:"Culturas",href:"/cadastro?secao=culturas",icon:Sprout,component:CulturasPage},
  {id:"tratos-culturais",name:"Manejo",href:"/cadastro?secao=tratos-culturais",icon:Shovel,component:TratosCulturaisPage},
];
