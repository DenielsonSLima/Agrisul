'use client';

import {useEffect,useRef,useState} from 'react';
import {Loader2,Pencil,Plus,RefreshCw,Search,Trash2,Users} from 'lucide-react';
import {LocalSearch} from '@/shared/components/Common';
import {notifications,useConfirmation} from '@/shared/feedback';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useEmployeeMutations,useEmployees} from '../hooks/useEmployees';
import type {Employee} from '../types';
import {EmployeeForm} from './EmployeeForm';
import '../styles.css';

export function FuncionariosPage(){
  const {user}=useAuth();
  return <EmployeeWorkspace key={user?.id??'anonymous'}/>;
}

function EmployeeWorkspace(){
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const query=useEmployees(),mutations=useEmployeeMutations(),confirm=useConfirmation();
  const [search,setSearch]=useState('');
  const [editing,setEditing]=useState<Employee|null|undefined>(undefined);
  const [deleting,setDeleting]=useState<string|null>(null);
  const term=search.trim().toLocaleLowerCase('pt-BR');
  const employees=query.employees.filter(employee=>!term||`${employee.fullName} ${employee.registrationNumber}`.toLocaleLowerCase('pt-BR').includes(term));
  const busy=mutations.saving||mutations.deleting;

  const remove=async(employee:Employee)=>{
    const accepted=await confirm({title:'Excluir funcionário?',description:`O cadastro de “${employee.fullName}”, matrícula ${employee.registrationNumber}, será excluído.`,confirmLabel:'Excluir funcionário',tone:'destructive'});
    if(!accepted)return;
    setDeleting(employee.id);
    try{await mutations.remove(employee.id);if(mounted.current)notifications.deleted(`O funcionário “${employee.fullName}” foi excluído.`);}
    catch(reason){if(mounted.current)notifications.error(reason instanceof Error?reason.message:'Não foi possível excluir o funcionário.');}
    finally{if(mounted.current)setDeleting(null);}
  };

  const add=query.canManage&&<button className="btn company-primary" type="button" onClick={()=>setEditing(null)} disabled={busy}><Plus size={17}/>Cadastrar funcionário</button>;
  return <section className="employees-workspace">
    <nav className="client-breadcrumb farm-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><span aria-hidden="true">›</span><span aria-current="page">Funcionários</span></nav>
    <div className="companies-heading"><div><h2>Funcionários</h2><p>Cadastre e consulte os funcionários pelo nome completo e pela matrícula.</p></div>{!query.loading&&!query.error&&add}</div>
    {query.loading?<div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando funcionários…</div>
      :query.error?<div className="company-empty" role="alert"><h3>Não foi possível carregar os funcionários</h3><p>{query.error}</p><button className="btn" type="button" onClick={()=>void query.reload()}><RefreshCw size={16}/>Tentar novamente</button></div>
      :!query.employees.length?<div className="company-empty"><span className="company-empty-icon"><Users size={25}/></span><h3>Nenhum funcionário cadastrado</h3><p>Os funcionários cadastrados aparecerão aqui com suas matrículas.</p>{add}</div>
      :<>
        <div className="employees-toolbar"><LocalSearch value={search} onChange={setSearch} placeholder="Buscar por nome ou matrícula"/><span>{employees.length} de {query.employees.length}</span></div>
        {!employees.length?<div className="company-empty"><Search size={24}/><h3>Nenhum funcionário encontrado</h3><button className="btn" type="button" onClick={()=>setSearch('')}>Limpar busca</button></div>
          :<div className="employees-table-wrap"><table className="employees-table"><thead><tr><th scope="col">Nome completo</th><th scope="col">Matrícula</th>{query.canManage&&<th scope="col" className="employee-actions-heading">Ações</th>}</tr></thead>
            <tbody>{employees.map(employee=><tr key={employee.id}><td>{employee.fullName}</td><td>{employee.registrationNumber}</td>{query.canManage&&<td><div className="employee-actions"><button className="btn small" type="button" onClick={()=>setEditing(employee)} disabled={busy} aria-label={`Editar ${employee.fullName}`}><Pencil size={14}/>Editar</button><button className="icon-btn employee-delete" type="button" aria-label={`Excluir ${employee.fullName}`} onClick={()=>void remove(employee)} disabled={busy}>{deleting===employee.id?<Loader2 size={15} className="animate-spin"/>:<Trash2 size={15}/>}</button></div></td>}</tr>)}</tbody>
          </table></div>}
      </>}
    {query.canManage&&editing!==undefined&&<EmployeeForm employee={editing??undefined} onClose={()=>setEditing(undefined)} onSave={async input=>{
      const saved=await mutations.save(input);
      if(!mounted.current)return saved;
      notifications[input.id?'updated':'created'](input.id?`O funcionário “${saved.fullName}” foi atualizado.`:`O funcionário “${saved.fullName}” foi cadastrado.`);
      setEditing(undefined);return saved;
    }}/>}
  </section>;
}
