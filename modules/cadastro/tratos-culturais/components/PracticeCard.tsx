import {Shovel,Pencil} from 'lucide-react';
import {managementCategories,type CulturalPractice} from '../types';
export function PracticeCard({practice,onOpen}:{practice:CulturalPractice;onOpen:()=>void}){
 const category=managementCategories.find(item=>item.value===practice.category)?.label??practice.category;
 return <button type="button" className="farm-card practice-card" onClick={onOpen} aria-label={'Editar manejo '+practice.name}>
  <span className="farm-card-top"><span className="farm-card-icon"><Shovel size={20} strokeWidth={1.6}/></span><Pencil size={14}/></span>
  <span className="practice-card-category">{category}</span>
  <span className="farm-card-name" title={practice.name}>{practice.name}</span>
  <span className="farm-card-location">{practice.cultureName} · {practice.cultureSubtypeName}</span>
  <span className="practice-card-description">{practice.description||'Sem observações'}</span>
 </button>;
}
