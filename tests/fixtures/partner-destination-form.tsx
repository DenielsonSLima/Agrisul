import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ClientForm} from '../../modules/cadastro/clientes/forms/ClientForm';

const state={saved:[] as Array<Record<string,unknown>>,notifications:[] as string[],lookupCount:0,navigated:'',fail:false,
 async rpc(_resource:string,action:string,payload:Record<string,unknown>){
  if(action!=='save')throw Error('Unexpected action');if(state.fail)throw Error('Código inválido no servidor');
  state.saved.push(payload);return {client:{...payload,id:'partner-one'}};
 },
 async lookup(){state.lookupCount++;return Response.json({details:{cnpj:'12345678000195',legalName:'Parceiro consultado',tradeName:'CONSULTADO',street:'Rua',number:'1',complement:'',district:'Centro',city:'Capela',state:'SE',zipCode:'49700000',phone:'',email:''}});},
};
Object.assign(window,{partnerDestinationFixture:state});
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><ClientForm client={{id:'partner-one',createdAt:'server-only',updatedAt:'server-only',cnpj:'12345678000195',legalName:'Parceiro',tradeName:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:'',destinationCode:'00008'}}/></QueryClientProvider>);
