'use client';
import {ArrowLeft, ShoppingBag} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';

export function ComprasPage() {
  return <section className="requests-workspace">
    <nav className="request-breadcrumb" aria-label="Caminho da solicitação"><ModuleLink href="/solicitacoes">Solicitações</ModuleLink><span aria-current="page">Compras</span></nav>
    <ModuleLink className="request-back" href="/solicitacoes"><ArrowLeft size={16}/>Voltar para solicitações</ModuleLink>
    <div className="request-heading"><div><span className="eyebrow">SOLICITAÇÕES / COMPRAS</span><h2>Solicitações de compras</h2><p>Acompanhe as necessidades de compra da empresa.</p></div></div>
    <div className="request-empty"><span className="request-empty-icon"><ShoppingBag size={28}/></span><h3>Compras</h3><p>Este espaço está preparado para a organização das solicitações de compras.</p></div>
  </section>;
}
