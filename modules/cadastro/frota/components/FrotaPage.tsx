'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {BadgeInfo, Loader2, Pencil, Plus, RefreshCw, Save, Search, Trash2, Truck} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import {notifications, useConfirmation} from '@/shared/feedback';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useClients} from '@/modules/cadastro/clientes/hooks/useClients';
import {useFleet, useFleetMutations} from '../hooks/useFleet';
import {weightInput, weightLabel} from '@/modules/pesagens/utils/presentation';
import {emptyFleetVehicle, type FleetVehicle, type FleetVehicleInput} from '../types';
import '../styles.css';

export function FrotaPage() {
  const {user} = useAuth();
  return <FleetWorkspace key={user?.id ?? 'anonymous'}/>;
}

function FleetWorkspace() {
  const [partnerId, setPartnerId] = useState('');
  const query = useFleet(partnerId ? {partnerId} : {});
  const partners = useClients();
  const mutations = useFleetMutations();
  const confirm = useConfirmation();
  const [editing, setEditing] = useState<FleetVehicle | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const vehicles = query.data?.vehicles ?? [];
  const canManage = query.data?.canManage ?? false;
  const value = search.trim().toLocaleLowerCase('pt-BR');
  const filtered = vehicles.filter(vehicle => !value || `${vehicle.internalCode} ${vehicle.plate} ${vehicle.partnerName} ${vehicle.model} ${vehicle.brand} ${vehicle.description}`.toLocaleLowerCase('pt-BR').includes(value));
  async function remove(vehicle: FleetVehicle) {
    const accepted = await confirm({title: 'Excluir veículo?', description: `O veículo “${vehicle.internalCode} · ${vehicle.plate || vehicle.model}” será removido da frota. Veículos vinculados a viagens não podem ser excluídos; os dados das pesagens ficam preservados.`, confirmLabel: 'Excluir', tone: 'destructive'});
    if (!accepted) return;
    try {await mutations.remove(vehicle.id); notifications.deleted('Veículo removido da frota.');}
    catch (reason) {notifications.error((reason as Error).message || 'Não foi possível excluir o veículo.');}
  }
  const addButton = canManage ? <button type="button" className="btn company-primary" onClick={() => setEditing(null)}><Plus size={17}/>Cadastrar veículo</button> : null;
  return <section className="fleet-workspace">
    <nav className="client-breadcrumb farm-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><span aria-hidden="true">›</span><span aria-current="page">Frota</span></nav>
    <div className="companies-heading"><div><h2>Frota</h2><p>Caminhões e reboques por parceiro, com número, placa e tara para as pesagens.</p></div>{addButton}</div>
    <div className="farm-toolbar fleet-toolbar"><label className="local-search"><Search size={16}/><span className="sr-only">Buscar veículo</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar número da frota, placa ou modelo…"/></label><label className="fleet-partner-filter">Parceiro<select value={partnerId} onChange={event => setPartnerId(event.target.value)} disabled={partners.loading || !!partners.error}><option value="">Toda a frota</option>{partners.clients.map(partner => <option key={partner.id} value={partner.id}>{partner.tradeName || partner.legalName}</option>)}</select></label><span>{filtered.length} veículos</span></div>
    {partners.error && <p className="form-error" role="alert">Não foi possível carregar os parceiros. <button className="btn" onClick={() => void partners.reload()}>Tentar novamente</button></p>}
    {query.loading ? <div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando frota…</div> : query.error ? <div className="company-empty" role="alert"><h3>Não foi possível carregar a frota</h3><p>{query.error}</p><button type="button" className="btn" onClick={() => void query.reload()}><RefreshCw size={16}/>Tentar novamente</button></div> : !filtered.length ? <div className="company-empty"><span className="company-empty-icon"><Truck size={25}/></span><h3>{search ? 'Nenhum veículo encontrado' : 'Nenhum veículo neste cadastro'}</h3><p>{search ? 'Ajuste a busca para localizar outro veículo.' : 'Cadastre os veículos ou selecione outro parceiro.'}</p>{addButton}</div> : <div className="fleet-grid">{filtered.map(vehicle => <article className="fleet-card" key={vehicle.id}><header><span><Truck size={19}/></span>{canManage && <div><button type="button" className="icon-btn" aria-label={`Editar frota ${vehicle.internalCode}`} onClick={() => setEditing(vehicle)}><Pencil size={15}/></button><button type="button" className="icon-btn" aria-label={`Excluir frota ${vehicle.internalCode}`} disabled={mutations.saving} onClick={() => void remove(vehicle)}><Trash2 size={15}/></button></div>}</header><small>{vehicle.partnerName || 'Frota geral'} · Nº da frota</small><strong>{vehicle.internalCode}</strong><h3>{vehicle.plate || vehicle.model || 'Placa não informada'}</h3><p className="fleet-brand">{vehicle.kind === 'truck' ? 'Caminhão' : vehicle.kind === 'trailer' ? 'Reboque' : [vehicle.brand, vehicle.model].filter(Boolean).join(' · ') || 'Tipo não informado'}</p><p className="fleet-tare">Tara: <b>{vehicle.tareKg == null ? 'Não informada' : `${weightLabel(vehicle.tareKg)} kg`}</b></p><p className="fleet-description"><BadgeInfo size={14}/><span>{vehicle.description || 'Sem observações'}</span></p></article>)}</div>}
    {editing !== undefined && <FleetForm vehicle={editing ?? undefined} defaultPartnerId={partnerId} onClose={() => setEditing(undefined)} onSave={async input => {const saved = await mutations.save(input); notifications[input.id ? 'updated' : 'created'](input.id ? 'Veículo atualizado com sucesso.' : 'Veículo cadastrado com sucesso.'); setEditing(undefined); return saved;}}/>}
  </section>;
}

function FleetForm({vehicle, defaultPartnerId, onClose, onSave}: {vehicle?: FleetVehicle; defaultPartnerId: string; onClose: () => void; onSave: (input: FleetVehicleInput) => Promise<FleetVehicle>}) {
  const partners = useClients();
  const [form, setForm] = useState<FleetVehicleInput>(() => vehicle ? {id: vehicle.id, internalCode: vehicle.internalCode, model: vehicle.model, brand: vehicle.brand, description: vehicle.description, partnerId: vehicle.partnerId, plate: vehicle.plate, kind: vehicle.kind, tareKg: weightInput(vehicle.tareKg)} : {...emptyFleetVehicle, partnerId: defaultPartnerId || null});
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), inFlight = useRef(false);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const change = (key: keyof FleetVehicleInput, value: string | null) => {setForm(current => ({...current, [key]: value})); setError('');};
  async function submit(event: FormEvent) {
    event.preventDefault(); if (inFlight.current) return;
    if (!form.internalCode.trim()) {setError('Informe o número da frota / código interno.'); return;}
    if (form.partnerId && !form.kind) {setError('Informe o tipo para a frota do parceiro.'); return;}
    if (!form.partnerId && (!form.model.trim() || !form.brand.trim())) {setError('Preencha modelo e marca para a frota geral.'); return;}
    inFlight.current = true; setSaving(true); setError('');
    try {await onSave({...form, tareKg: form.tareKg?.trim() || null});}
    catch (reason) {if (mounted.current) {const message = (reason as Error).message || 'Não foi possível salvar o veículo.'; setError(message); notifications.error(message);}}
    finally {inFlight.current = false; if (mounted.current) setSaving(false);}
  }
  return <Dialog open onOpenChange={open => {if (!open && !inFlight.current) onClose();}}><DialogContent className="form-modal fleet-modal" showCloseButton={!saving} onEscapeKeyDown={event => {if (saving) event.preventDefault();}} onPointerDownOutside={event => {if (saving) event.preventDefault();}}><DialogHeader><DialogTitle>{vehicle ? 'Editar veículo' : 'Cadastrar veículo'}</DialogTitle><DialogDescription>A tara fica disponível nos próximos lançamentos. Alterações não modificam as viagens já salvas.</DialogDescription></DialogHeader><form onSubmit={event => void submit(event)}><fieldset disabled={saving}>
    <Field label="Parceiro"><select value={form.partnerId || ''} onChange={event => change('partnerId', event.target.value || null)} disabled={partners.loading || !!partners.error}><option value="">Frota geral / sem parceiro</option>{partners.clients.map(partner => <option key={partner.id} value={partner.id}>{partner.tradeName || partner.legalName}</option>)}</select></Field>
    {partners.error && <p className="form-error" role="alert">{partners.error}<button type="button" className="btn" onClick={() => void partners.reload()}>Tentar novamente</button></p>}
    <div className="form-grid"><Field label="Nº da frota / código interno *"><input required autoFocus value={form.internalCode} maxLength={60} onChange={event => change('internalCode', event.target.value)}/></Field><Field label="Placa (se conhecida)"><input value={form.plate || ''} maxLength={12} placeholder="ABC1D23" onChange={event => change('plate', event.target.value.toUpperCase())}/></Field></div>
    <div className="form-grid"><Field label={`Tipo${form.partnerId ? ' *' : ''}`}><select required={!!form.partnerId} value={form.kind || ''} onChange={event => change('kind', event.target.value || null)}><option value="">Selecione</option><option value="truck">Caminhão</option><option value="trailer">Reboque</option></select></Field><Field label="Tara padrão (kg)"><input inputMode="decimal" maxLength={30} value={form.tareKg || ''} placeholder="Ex.: 16.680" onChange={event => change('tareKg', event.target.value)}/></Field></div>
    <div className="form-grid"><Field label={`Marca${!form.partnerId ? ' *' : ' (opcional)'}`}><input required={!form.partnerId} value={form.brand} maxLength={100} placeholder="Ex.: Volvo" onChange={event => change('brand', event.target.value)}/></Field><Field label={`Modelo${!form.partnerId ? ' *' : ' (opcional)'}`}><input required={!form.partnerId} value={form.model} maxLength={150} onChange={event => change('model', event.target.value)}/></Field></div>
    <Field label="Observações"><textarea rows={3} maxLength={1000} value={form.description} onChange={event => change('description', event.target.value)}/></Field>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button><button type="submit" className="btn company-primary" disabled={saving || partners.loading || !!partners.error}>{saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>} {saving ? 'Salvando…' : vehicle ? 'Salvar alterações' : 'Cadastrar veículo'}</button></div></form></DialogContent></Dialog>;
}
