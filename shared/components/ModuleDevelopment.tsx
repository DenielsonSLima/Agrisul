import type { LucideIcon } from "lucide-react";
import { Wrench } from "lucide-react";

export function ModuleDevelopment({name,icon:Icon}:{name:string;icon:LucideIcon}) {
  return <section className="module-development" aria-labelledby="module-title">
    <div className="module-development-icon"><Icon size={30} strokeWidth={1.5}/></div>
    <h1 id="module-title">{name}</h1>
    <p className="development-status"><Wrench size={15}/>Em desenvolvimento</p>
  </section>;
}
