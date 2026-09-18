'use client';
import {useState, type ReactNode} from 'react';
import {ArrowRight, ArrowUpRight, Banknote, Building2, CalendarDays, ChartNoAxesCombined, CheckCircle2, ClipboardList, FileChartColumn, FileText, LayoutGrid, Leaf, Plus, RefreshCw, Settings, Sprout, TriangleAlert, Truck, Users, Wrench, type LucideIcon} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {useApp} from '@/shared/state/AppProvider';
import {dateLabel, decimalLabel, moneyLabel, monthLabel} from '@/shared/utils/presentation';
import {useDashboard} from '../hooks/useDashboard';
import {DashboardFilter} from '../forms/DashboardFilter';
import {greeting, workspaceDate, workspaceDay} from '../utils/greeting';
import type {HomeData} from '../types';
import '../styles.css';

const servicesHref = '/solicitacoes?secao=servico';
const contractHref = (id: string) => `/contratos?contrato=${encodeURIComponent(id)}`;

export function InicioPage() {
  const [month, setMonth] = useState(() => workspaceDay().slice(0, 7));
  const model = useDashboard(month), data = model.data;
  const app = useApp();
  const name = app.settings.name?.trim().split(/\s+/)[0];
  const today = data?.today ?? workspaceDay();
  return <section className="inicio-page">
    <header className="inicio-heading">
      <div><span className="eyebrow">SEU DIA EM FOCO</span><h2>{greeting()}{name ? `, ${name}` : ''}.</h2><p>Veja o que precisa de atenção e continue de onde parou.</p></div>
      <div className="inicio-date"><CalendarDays size={17}/><time dateTime={today}>{workspaceDate(today)}</time></div>
    </header>
    {model.loading ? <div className="inicio-loading" role="status"><RefreshCw className="animate-spin" size={20}/><p>Preparando a visão do seu dia…</p></div>
      : model.errorMessage ? <div className="inicio-empty" role="alert"><TriangleAlert/><h3>Não foi possível atualizar o Início</h3><p>{model.errorMessage}</p><button className="btn" onClick={() => void model.reload()}><RefreshCw size={16}/>Tentar novamente</button></div>
      : data && <div className="inicio-content" aria-busy={model.isFetching}>
        <div className="inicio-toolbar"><div className="inicio-company"><Building2 size={17}/><span>{model.company?.name || 'Meu espaço de trabalho'}</span></div><div className="inicio-toolbar-actions">{data.permissions.contracts && <DashboardFilter value={month} onChange={setMonth}/>}<button className="inicio-refresh" type="button" disabled={model.isFetching} onClick={() => void model.reload()} aria-label="Atualizar informações do início" title="Atualizar informações"><RefreshCw size={17} className={model.isFetching ? 'animate-spin' : ''}/></button></div></div>
        {data.finance && <FinancialOverview data={data}/>}
        {!model.company && data.permissions.contracts && <div className="inicio-setup"><Building2 size={24}/><div><h3>{model.companyError ? 'Seleção de empresa indisponível' : 'Comece pela sua empresa'}</h3><p>{model.companyError ? 'Os indicadores financeiros precisam de uma empresa selecionada. Os dados compartilhados continuam disponíveis abaixo.' : 'Cadastre uma empresa para acompanhar contratos, carregamentos e faturamento.'}</p></div>{data.permissions.createCompany && <ModuleLink href="/configuracoes?secao=empresas" className="btn company-primary">Cadastrar empresa<ArrowRight size={15}/></ModuleLink>}</div>}
        <Priorities data={data}/>
        <div className="inicio-columns">
          <div className="inicio-column">
            {data.requests && <Panel title="Solicitações de serviço" subtitle="Compartilhadas no espaço de trabalho" icon={Wrench} href={servicesHref} link="Ver todas">
              <div className="inicio-request-totals"><ModuleLink href={servicesHref}><strong>{data.requests.pendingCount}</strong><span>Aguardando aprovação</span></ModuleLink><ModuleLink href={`${servicesHref}&aba=in_progress`}><strong>{data.requests.inProgressCount}</strong><span>Serviços em andamento</span></ModuleLink></div>
              {data.requests.items.length ? <ul className="inicio-list">{data.requests.items.map(request => <li key={request.id}><ModuleLink href={`${servicesHref}&solicitacao=${request.id}`} className="inicio-record"><span className={`inicio-record-icon ${request.overdue ? 'warning' : ''}`}><Wrench size={17}/></span><div><strong>Nº {request.number} · {request.providerName}</strong><small>{request.requesterName}{request.returnDate ? ` · Retorno ${dateLabel(request.returnDate)}` : ' · Sem retorno previsto'}</small></div><span className={`inicio-badge ${request.overdue ? 'warning' : request.status === 'open' ? 'pending' : ''}`}>{request.overdue ? 'Retorno atrasado' : request.status === 'open' ? 'Aberta' : 'Em andamento'}</span><ArrowUpRight className="inicio-row-arrow" size={16}/></ModuleLink></li>)}</ul> : <Empty icon={CheckCircle2} title="Nenhum serviço pendente" detail="Novas solicitações e serviços em andamento aparecerão aqui."/>}
              {data.permissions.createRequest && <ModuleLink href={`${servicesHref}&nova=1`} className="inicio-panel-action"><Plus size={16}/>Nova solicitação</ModuleLink>}
            </Panel>}
            {data.contracts && <Panel title="Prazos dos contratos" subtitle="Ativos com término vencido ou nos próximos 30 dias" icon={FileText} href="/contratos" link="Ver contratos">
              {data.contracts.items.length ? <ul className="inicio-list">{data.contracts.items.map(contract => <li key={contract.id}><ModuleLink href={contractHref(contract.id)} className="inicio-record"><span className={`inicio-record-icon ${contract.overdue ? 'warning' : ''}`}><FileText size={17}/></span><div><strong>{contract.clientName}</strong><small>{contract.label} · Término {dateLabel(contract.endDate)}</small></div><span className={`inicio-badge ${contract.overdue ? 'warning' : ''}`}>{contract.overdue ? 'Prazo vencido' : 'A encerrar'}</span><ArrowUpRight className="inicio-row-arrow" size={16}/></ModuleLink></li>)}</ul> : <Empty icon={CheckCircle2} title="Nenhum término próximo" detail="Os contratos ativos não têm término vencido ou previsto para os próximos 30 dias."/>}
            </Panel>}
            {data.permissions.registrations && <PlanningPanel data={data}/>}
          </div>
          <div className="inicio-column">
            {data.agenda && <Panel title="Próximos 7 dias" subtitle={`${dateLabel(data.agenda.from)} a ${dateLabel(data.agenda.to)}`} icon={CalendarDays} href={`/agenda?dia=${today}`} link="Abrir agenda">
              <div className="inicio-agenda-caption"><span><strong>{data.agenda.todayCount}</strong> registros hoje</span><small>{data.agenda.total} no período</small></div>
              {data.agenda.items.length ? <ol className="inicio-agenda-list">{data.agenda.items.map(event => <li key={event.id}><ModuleLink href={contractHref(event.contractId)}><time className={event.date === today ? 'is-today' : ''} dateTime={event.date}><strong>{event.date.slice(8)}</strong><small>{new Intl.DateTimeFormat('pt-BR', {month: 'short'}).format(new Date(`${event.date}T12:00:00`))}</small></time><div><strong>{event.title}</strong><p>{event.detail}</p><small>{event.amount ? moneyLabel(event.amount) : event.volume ? `${decimalLabel(event.volume)} t` : event.contractNumber || 'Ver contrato'}</small></div><ArrowUpRight size={15}/></ModuleLink></li>)}</ol> : <Empty icon={CalendarDays} title="Agenda livre neste período" detail="Datas de contratos, cargas e movimentações aparecem aqui automaticamente."/>}
              {data.agenda.total > data.agenda.items.length && <ModuleLink className="inicio-panel-action" href={`/agenda?dia=${today}`}>Ver todos os registros<ArrowRight size={15}/></ModuleLink>}
            </Panel>}
            <Panel title="Acesso rápido" subtitle="Continue sua rotina" icon={LayoutGrid}>
              <nav className="inicio-shortcuts" aria-label="Acesso rápido aos módulos">
                {data.permissions.createContract && <Shortcut href="/contratos?novo=1" icon={Plus} title="Novo contrato" detail="Formalizar uma negociação"/>}
                {data.permissions.requests && <Shortcut href={servicesHref} icon={ClipboardList} title="Solicitações" detail="Serviços, orçamentos e aprovações"/>}
                {data.permissions.registrations && <Shortcut href="/cadastro?secao=clientes" icon={Users} title="Cadastros" detail="Clientes, prestadores, fazendas e talhões"/>}
                {data.permissions.registrations && <Shortcut href="/planejamento" icon={Sprout} title="Planejamento" detail="Metas, plantio, manejo e colheita"/>}
                {data.permissions.summary && <Shortcut href="/resumo" icon={ChartNoAxesCombined} title="Resumo gerencial" detail="Evolução e resultados da operação"/>}
                {(data.permissions.contracts || data.permissions.registrations) && <Shortcut href={data.permissions.contracts ? '/relatorios' : '/relatorios?tipo=farms'} icon={FileChartColumn} title="Relatórios" detail="Consultar e exportar informações"/>}
                <Shortcut href="/configuracoes?secao=perfil" icon={Settings} title="Meu perfil" detail="Conta e preferências"/>
              </nav>
            </Panel>
          </div>
        </div>
        {data.registrations && <section className="inicio-registry" aria-label="Cadastros do espaço de trabalho"><div><Leaf size={21}/><div><h3>Sua base de operação</h3><p>Cadastros compartilhados entre empresas</p></div></div><RegistryLink href="/cadastro?secao=clientes" value={data.registrations.clientCount} label="Clientes"/><RegistryLink href="/cadastro?secao=prestadores" value={data.registrations.providerCount} label="Prestadores"/><RegistryLink href="/cadastro?secao=fazenda" value={data.registrations.farmCount} label="Fazendas"/><RegistryLink href="/cadastro?secao=fazenda" value={data.registrations.plotCount} label="Talhões"/></section>}
        <p className="inicio-footnote">{data.finance ? 'Financeiro e cargas seguem o mês e a empresa selecionados. ' : ''}Pendências, agenda e safra mostram a situação atual. Horário de Brasília. <span>Atualizado às {new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'}).format(new Date(data.generatedAt))}.</span></p>
      </div>}
  </section>;
}

function FinancialOverview({data}: {data: HomeData}) {
  const finance = data.finance!;
  return <section className="inicio-finance" aria-label={`Indicadores de ${monthLabel(data.month)}`}>
    <div className="inicio-finance-main"><span className="inicio-kicker">FATURAMENTO LÍQUIDO · {monthLabel(data.month)}</span><strong>{moneyLabel(finance.netAmount)}</strong><p>{finance.pendingLoadCount ? `${finance.pendingLoadCount} carga(s) aguardam ATR ou cotação.` : 'Valor dos carregamentos após os descontos.'}</p>{data.permissions.summary && <ModuleLink href="/resumo">Explorar resultados<ArrowUpRight size={15}/></ModuleLink>}</div>
    <dl className="inicio-finance-metrics"><Metric icon={Banknote} label="Entradas líquidas em caixa" value={moneyLabel(finance.receivedAmount)} detail="Recebimentos + adiantamentos − estornos"/><Metric icon={Truck} label="Volume carregado" value={`${decimalLabel(finance.loadedVolume)} t`} detail={`${finance.loadCount} carregamento(s) no mês`}/><Metric icon={FileText} label="Contratos ativos" value={String(finance.activeContractCount)} detail={`${finance.contractCount} contrato(s) cadastrados na empresa`}/></dl>
  </section>;
}
function Metric({icon: Icon, label, value, detail}: {icon: LucideIcon; label: string; value: string; detail: string}) {
  return <div><dt><Icon size={17}/>{label}</dt><dd>{value}</dd><small>{detail}</small></div>;
}
function Priorities({data}: {data: HomeData}) {
  const cards = [
    ...(data.requests?.overdueCount ? [{key: 'returns', count: data.requests.overdueCount, title: 'Retornos atrasados', detail: 'Serviços aprovados ainda em andamento.', href: `${servicesHref}&aba=in_progress`, warning: true}] : []),
    ...(data.contracts?.overdueCount ? [{key: 'contracts', count: data.contracts.overdueCount, title: 'Contratos com prazo vencido', detail: 'Revise a execução e o encerramento.', href: contractHref(data.contracts.items[0].id), warning: true}] : []),
    ...(data.finance?.pendingLoadCount ? [{key: 'billing', count: data.finance.pendingLoadCount, title: 'Cargas a apurar', detail: 'Confira ATR e cotação do mês selecionado.', href: data.finance.pendingContracts[0] ? contractHref(data.finance.pendingContracts[0].id) : '/contratos', warning: true}] : []),
    ...(data.requests?.pendingCount ? [{key: 'requests', count: data.requests.pendingCount, title: 'Solicitações abertas', detail: 'Aguardando decisão do diretor geral.', href: servicesHref, warning: false}] : []),
  ];
  if (!cards.length) return data.finance || data.requests ? <div className="inicio-clear"><CheckCircle2 size={18}/><div><strong>Nenhuma pendência sinalizada</strong><span>Contratos, solicitações e apuração disponíveis para seu perfil estão em dia nas verificações deste painel.</span></div></div> : null;
  return <section className="inicio-attention" aria-labelledby="inicio-attention-title"><div className="inicio-section-title"><h3 id="inicio-attention-title"><TriangleAlert size={17}/>Precisa de atenção</h3><span>Pendências com acesso direto</span></div><div className="inicio-alerts">{cards.map(card => <ModuleLink key={card.key} href={card.href} className={`inicio-alert ${card.warning ? 'warning' : ''}`}><span className="inicio-alert-count">{card.count}</span><div><strong>{card.title}</strong><p>{card.detail}</p></div><ArrowUpRight size={17}/></ModuleLink>)}</div></section>;
}
function PlanningPanel({data}: {data: HomeData}) {
  const plan = data.planning;
  return <Panel title="Safra em andamento" subtitle="Planejamento compartilhado no espaço de trabalho" icon={Sprout} href={plan ? `/planejamento?plano=${plan.id}` : '/planejamento'} link="Ver planejamento">
    {plan ? <div className="inicio-planning"><div className="inicio-planning-heading"><div><h4>{plan.name}</h4><p>Até {dateLabel(plan.endDate)} · acumulado até {dateLabel(plan.asOf)}</p></div><span className="inicio-badge">Em andamento</span></div><Progress title="Plantio realizado" percent={plan.plantingPercent} actual={plan.plantedAreaHa} target={plan.targetAreaHa} unit="ha"/><Progress title="Colheita realizada" percent={plan.harvestPercent} actual={plan.harvestedTons} target={plan.harvestTargetTons} unit="t"/><p className="inicio-planning-note">{decimalLabel(plan.allocatedAreaHa)} ha distribuídos para plantio.{plan.activePeriodCount > 1 ? ` ${plan.activePeriodCount} safras em andamento; exibindo a que termina por último.` : ''}</p></div> : <Empty icon={Sprout} title="Nenhuma safra em andamento" detail="Crie ou consulte os períodos no Planejamento para acompanhar a execução agrícola."/>}
  </Panel>;
}
function Progress({title, percent, actual, target, unit}: {title: string; percent: string; actual: string; target: string; unit: string}) {
  const width = Math.max(0, Math.min(100, Number(percent) || 0));
  return <div className="inicio-progress"><div><strong>{title}</strong><span>{percent === '' ? 'Sem meta definida' : `${decimalLabel(percent)}%`}</span></div><div className="inicio-progress-track" role="img" aria-label={`${title}: ${decimalLabel(actual)} de ${decimalLabel(target)} ${unit}`}><i style={{width: `${width}%`}}/></div><p><strong>{decimalLabel(actual)} {unit}</strong><span>Meta: {decimalLabel(target)} {unit}</span></p></div>;
}
function Panel({title, subtitle, icon: Icon, href, link, children}: {title: string; subtitle: string; icon: LucideIcon; href?: string; link?: string; children: ReactNode}) {
  return <section className="inicio-panel"><header><div><h3><Icon size={17}/>{title}</h3><p>{subtitle}</p></div>{href && <ModuleLink href={href}>{link}<ArrowUpRight size={14}/></ModuleLink>}</header>{children}</section>;
}
function Empty({icon: Icon, title, detail}: {icon: LucideIcon; title: string; detail: string}) {
  return <div className="inicio-empty"><Icon size={25}/><h4>{title}</h4><p>{detail}</p></div>;
}
function Shortcut({href, icon: Icon, title, detail}: {href: string; icon: LucideIcon; title: string; detail: string}) {
  return <ModuleLink href={href}><span><Icon size={19}/></span><div><strong>{title}</strong><small>{detail}</small></div><ArrowRight size={16}/></ModuleLink>;
}
function RegistryLink({href, value, label}: {href: string; value: number; label: string}) {
  return <ModuleLink href={href}><strong>{value}</strong><span>{label}<ArrowUpRight size={13}/></span></ModuleLink>;
}
