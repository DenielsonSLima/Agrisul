import {Building2,FileType2,ShieldCheck,Stamp,UserRound,Users} from "lucide-react";
import {EmpresasPage} from "./empresas/components/EmpresasPage";
import {PerfilPage} from "./perfil/components/PerfilPage";
import {UsuariosPage} from "./usuarios/components/UsuariosPage";
import {PerfisAcessoPage} from "./perfis-acesso";
import {MarcaDaguaPage} from "./marca-dagua/components/MarcaDaguaPage";
import {CabecalhoRelatoriosPage} from "./cabecalho-relatorios";

export const configuracoesSections=[
 {id:"empresas",title:"Empresas",description:"Empresa principal e unidades.",icon:Building2,component:EmpresasPage},
 {id:"perfil",title:"Meu perfil",description:"Dados da conta e preferências.",icon:UserRound,component:PerfilPage},
 {id:"usuarios",title:"Usuários",description:"Equipe e acessos ao espaço.",icon:Users,component:UsuariosPage},
 {id:"perfis-acesso",title:"Perfis de acesso",description:"Permissões por função.",icon:ShieldCheck,component:PerfisAcessoPage},
 {id:"marca-dagua",title:"Marca d’água",description:"Identidade dos documentos.",icon:Stamp,component:MarcaDaguaPage},
 {id:"cabecalho-relatorios",title:"Cabeçalho de relatórios",description:"Modelos em retrato e paisagem.",icon:FileType2,component:CabecalhoRelatoriosPage},
] as const;
