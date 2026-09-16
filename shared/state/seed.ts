import {Customer,Contract,Event} from "../types";
export const customers:Customer[]=[
{id:"p1",name:"Horizonte Arquitetura",email:"contato@horizonte.example",phone:"(79) 99912-3456",type:"Empresa"},
{id:"p2",name:"Marina Oliveira",email:"marina@example.com",phone:"(79) 99821-4321",type:"Pessoa física"},
{id:"p3",name:"Studio Norte",email:"oi@studionorte.example",phone:"(79) 99934-5678",type:"Empresa"},
{id:"p4",name:"Lucas Almeida",email:"lucas@example.com",phone:"(79) 99876-5432",type:"Pessoa física"},
{id:"p5",name:"Verde Café",email:"contato@verdecafe.example",phone:"(79) 99123-4567",type:"Empresa"},
{id:"p6",name:"Vértice Consultoria",email:"contato@vertice.example",phone:"(79) 99222-1010",type:"Empresa"}];
export const contracts:Contract[]=[
{id:"CT-006",title:"Consultoria de gestão",customerId:"p1",value:4800,date:"2026-09-25",status:"Ativo"},
{id:"CT-005",title:"Prestação de serviços",customerId:"p2",value:2400,date:"2026-09-18",status:"Pendente"},
{id:"CT-004",title:"Assessoria mensal",customerId:"p3",value:3600,date:"2026-09-30",status:"Ativo"},
{id:"CT-003",title:"Consultoria estratégica",customerId:"p4",value:1800,date:"2026-09-21",status:"Em análise"},
{id:"CT-002",title:"Gestão de processos",customerId:"p5",value:3200,date:"2026-08-28",status:"Concluído"},
{id:"CT-001",title:"Planejamento empresarial",customerId:"p6",value:4200,date:"2026-07-20",status:"Concluído"}];
export const events:Event[]=[
{id:"e1",title:"Reunião com Horizonte",date:"2026-09-14",time:"09:00",type:"Reunião",done:false},
{id:"e2",title:"Revisar contrato da Marina",date:"2026-09-14",time:"14:30",type:"Contrato",done:false},
{id:"e3",title:"Alinhamento com Studio Norte",date:"2026-09-14",time:"16:00",type:"Reunião",done:false},
{id:"e4",title:"Entrega do planejamento",date:"2026-09-16",time:"10:00",type:"Entrega",done:false},
{id:"e5",title:"Retorno para Lucas Almeida",date:"2026-09-18",time:"11:00",type:"Reunião",done:false}];
