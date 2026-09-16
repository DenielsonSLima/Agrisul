import {Customer} from "@/shared/types";
export function createCustomer(data:Omit<Customer,"id">):Customer{if(!data.name.trim())throw new Error("Informe o nome.");if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw new Error("Informe um e-mail válido.");return {...data,name:data.name.trim(),id:crypto.randomUUID()}}
