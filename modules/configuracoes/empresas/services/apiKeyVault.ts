import {env} from "cloudflare:workers";
export async function encryptApiKey(value:string,ownerId:string,companyId:string){
 const secret=(env as unknown as {COMPANY_KEY_ENCRYPTION_KEY?:string}).COMPANY_KEY_ENCRYPTION_KEY;
 if(!secret)throw new Error("API credential storage unavailable");
 const key=await crypto.subtle.importKey("raw",Uint8Array.from(atob(secret),c=>c.charCodeAt(0)),"AES-GCM",false,["encrypt"]);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(ownerId+":"+companyId)},key,new TextEncoder().encode(value));
 const bytes=new Uint8Array(iv.length+data.byteLength);bytes.set(iv);bytes.set(new Uint8Array(data),iv.length);
 return btoa(String.fromCharCode(...bytes));
}
