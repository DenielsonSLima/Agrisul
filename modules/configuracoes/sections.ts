import {lazy} from "react";
import {Building2,FileType2,ShieldCheck,Stamp,UserRound,Users} from "lucide-react";
const EmpresasPage=lazy(()=>import("./empresas/components/EmpresasPage").then(module=>({default:module.EmpresasPage})));
const PerfilPage=lazy(()=>import("./perfil/components/PerfilPage").then(module=>({default:module.PerfilPage})));
const UsuariosPage=lazy(()=>import("./usuarios/components/UsuariosPage").then(module=>({default:module.UsuariosPage})));
const PerfisAcessoPage=lazy(()=>import("./perfis-acesso").then(module=>({default:module.PerfisAcessoPage})));
const MarcaDaguaPage=lazy(()=>import("./marca-dagua/components/MarcaDaguaPage").then(module=>({default:module.MarcaDaguaPage})));
const CabecalhoRelatoriosPage=lazy(()=>import("./cabecalho-relatorios").then(module=>({default:module.CabecalhoRelatoriosPage})));

export const configuracoesSections=[
 {id:"empresas",title:"Empresas",description:"Empresa principal e unidades.",icon:Building2,component:EmpresasPage},
 {id:"perfil",title:"Meu perfil",description:"Dados da conta e preferências.",icon:UserRound,component:PerfilPage},
 {id:"usuarios",title:"Usuários",description:"Equipe e acessos ao espaço.",icon:Users,component:UsuariosPage},
 {id:"perfis-acesso",title:"Perfis de acesso",description:"Permissões por função.",icon:ShieldCheck,component:PerfisAcessoPage},
 {id:"marca-dagua",title:"Marca d’água",description:"Identidade dos documentos.",icon:Stamp,component:MarcaDaguaPage},
 {id:"cabecalho-relatorios",title:"Cabeçalho de relatórios",description:"Modelos em retrato e paisagem.",icon:FileType2,component:CabecalhoRelatoriosPage},
] as const;
