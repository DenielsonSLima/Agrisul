'use client';

import {useRef, useState} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardCheck,
  ClipboardList,
  Loader2,
  PackageOpen,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
} from 'lucide-react';
import {Field, LocalSearch} from '@/shared/components/Common';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {notifications} from '@/shared/feedback';
import {ModuleLink, useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {dateLabel} from '@/shared/utils/presentation';
import type {Signature} from '@/modules/cadastro/assinaturas/types';
import {useProviders} from '@/modules/cadastro/prestadores/hooks/useProviders';
import {providerDocument} from '@/modules/cadastro/prestadores/presentation';
import type {ServiceProvider} from '@/modules/cadastro/prestadores/types';
import {useMaterials, useQuotationRequesters, useQuoteMutations} from '../hooks/useQuotes';
import type {Material, QuoteItem, QuoteProvider} from '../types';
import {emptyItem, listHref, today} from './QuoteShared';
import {MaterialThumbnail, QuoteMaterialPicker} from './QuoteMaterialPicker';
import {quoteMaterialOptions} from './quoteMaterialOptions';

type Draft = {
  requestDate: string;
  requesterId: string;
  requester: string;
  notes: string;
  items: QuoteItem[];
  providers: QuoteProvider[];
};

const initial = (): Draft => ({
  requestDate: today(),
  requesterId: '',
  requester: '',
  notes: '',
  items: [emptyItem()],
  providers: [],
});

const steps = [
  ['Dados', 'Data e solicitante'],
  ['Materiais', 'Itens e quantidades'],
  ['Prestadores', 'Selecionar fornecedores'],
  ['Resumo', 'Revisar e criar'],
] as const;

const toQuoteProvider = (provider: ServiceProvider): QuoteProvider => ({
  id: crypto.randomUUID(),
  providerId: provider.id,
  providerName: provider.legalName,
  providerEmail: provider.email,
  providerPhone: provider.phone,
  values: {},
  notes: '',
  sentAt: null,
});

export function QuoteCreatePage() {
  const {navigate} = useModuleNavigation();
  const materials = useMaterials();
  const requestersQuery = useQuotationRequesters();
  const providersQuery = useProviders();
  const mutation = useQuoteMutations();
  const dialogRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<Draft>(initial);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const providers = providersQuery.data?.providers ?? [];

  const patch = (value: Partial<Draft>) => {
    setDraft(current => ({...current, ...value}));
  };

  const updateItem = (id: string, value: Partial<QuoteItem>) => {
    setDraft(current => ({
      ...current,
      items: current.items.map(item => {
        if (item.id !== id) return item;
        const next = {...item, ...value};
        if (value.materialId !== undefined) {
          const material = materials.materials.find(entry => entry.id === value.materialId);
          const first = material?.references[0];
          next.materialVariantId = first?.id ?? null;
          next.materialName = material?.name ?? '';
          next.materialCode = material?.internalCode ?? '';
          next.materialApplication = material?.application ?? '';
          next.materialReferences = material?.references.map(reference => ({
            brand: reference.brand,
            code: reference.code,
          })) ?? [];
          next.unit = material?.unit ?? '';
        }
        return next;
      }),
    }));
  };

  const toggleProvider = (provider: ServiceProvider) => {
    setDraft(current => ({
      ...current,
      providers: current.providers.some(entry => entry.providerId === provider.id)
        ? current.providers.filter(entry => entry.providerId !== provider.id)
        : [...current.providers, toQuoteProvider(provider)],
    }));
  };

  const validateStep = (target: number) => {
    if (target === 0 && (!draft.requestDate || !draft.requesterId)) {
      return 'Informe a data e selecione o solicitante.';
    }
    if (target === 1 && (
      !draft.items.length
      || draft.items.some(item => !item.materialId || !item.quantity.trim())
    )) {
      return 'Selecione um produto e informe a quantidade.';
    }
    if (target === 2 && !draft.providers.length) {
      return 'Selecione ao menos um prestador.';
    }
    return '';
  };

  const goToStep = (target: number, message = '') => {
    setStep(target);
    setError(message);
    requestAnimationFrame(() => {
      dialogRef.current?.scrollTo({top: 0, behavior: 'smooth'});
      panelRef.current?.focus({preventScroll: true});
    });
  };

  const close = () => {
    if (!mutation.saving) navigate(listHref);
  };

  const advance = () => {
    const message = validateStep(step);
    if (message) {
      setError(message);
      return;
    }
    goToStep(Math.min(3, step + 1));
  };

  const save = async () => {
    const invalid = ([0, 1, 2] as const)
      .map(index => ({index, message: validateStep(index)}))
      .find(result => result.message);
    if (invalid) {
      goToStep(invalid.index, invalid.message);
      return;
    }
    if (mutation.saving) return;
    try {
      const title = `Cotação de ${dateLabel(draft.requestDate)}`;
      const saved = await mutation.save({
        title,
        number: '',
        requestDate: draft.requestDate,
        requester: draft.requester.trim(),
        requesterSignatureId: draft.requesterId,
        notes: draft.notes.trim(),
        items: draft.items,
        providers: draft.providers,
      });
      notifications.created('Cotação criada. O número foi gerado automaticamente.');
      navigate(`/cotacao?cotacao=${encodeURIComponent(saved.id)}`, {replace: true});
    } catch (reason) {
      const message = (reason as Error).message || 'Não foi possível criar a cotação.';
      setError(message);
      notifications.error(message);
    }
  };

  return (
    <Dialog open onOpenChange={open => {if (!open) close();}}>
      <DialogContent
        ref={dialogRef}
        className="form-modal quote-create-modal"
        showCloseButton={!mutation.saving}
        onEscapeKeyDown={event => {if (mutation.saving) event.preventDefault();}}
        onPointerDownOutside={event => {if (mutation.saving) event.preventDefault();}}
      >
        <DialogHeader>
          <DialogTitle>Nova cotação</DialogTitle>
          <DialogDescription>
            Informe os dados, escolha os materiais e prestadores e confira tudo antes de criar.
          </DialogDescription>
        </DialogHeader>

        <nav className="quote-steps" aria-label="Etapas da nova cotação">
          {steps.map(([title, description], index) => (
            <button
              key={title}
              type="button"
              className={`${index === step ? 'active ' : ''}${index < step ? 'complete' : ''}`}
              aria-current={index === step ? 'step' : undefined}
              onClick={() => {if (index < step) goToStep(index);}}
              disabled={index > step}
            >
              <span>{index < step ? <Check size={16}/> : index + 1}</span>
              <strong>{title}</strong>
              <small>{description}</small>
            </button>
          ))}
        </nav>

        <main ref={panelRef} className="quote-step-panel" tabIndex={-1}>
          {step === 0 && (
            <DataStep
              draft={draft}
              requesters={requestersQuery.requesters}
              loading={requestersQuery.loading}
              loadError={requestersQuery.error}
              onReload={requestersQuery.reload}
              patch={patch}
            />
          )}
          {step === 1 && (
            <MaterialsStep
              materials={materials.materials}
              loading={materials.loading}
              loadError={materials.error}
              items={draft.items}
              onReload={materials.reload}
              onAdd={() => patch({items: [...draft.items, emptyItem()]})}
              onRemove={id => patch({items: draft.items.filter(item => item.id !== id)})}
              onChange={updateItem}
            />
          )}
          {step === 2 && (
            <ProvidersStep
              providers={providers}
              loading={providersQuery.loading}
              loadError={providersQuery.error}
              selected={draft.providers}
              onReload={providersQuery.reload}
              onToggle={toggleProvider}
            />
          )}
          {step === 3 && (
            <ReviewStep
              draft={draft}
              materials={materials.materials}
              onEdit={target => goToStep(target)}
            />
          )}

          {error && <p className="form-error quote-step-error" role="alert">{error}</p>}

          <footer className="quote-step-actions">
            <button
              className="btn"
              type="button"
              disabled={mutation.saving}
              onClick={() => {
                if (step === 0) {
                  close();
                  return;
                }
                goToStep(Math.max(0, step - 1));
              }}
            >
              {step === 0 ? 'Cancelar' : <><ArrowLeft size={16}/>Voltar</>}
            </button>
            {step < 3 ? (
              <button className="btn company-primary" type="button" onClick={advance}>
                Avançar <ArrowRight size={16}/>
              </button>
            ) : (
              <button
                className="btn company-primary quote-create-submit"
                type="button"
                disabled={mutation.saving}
                onClick={() => void save()}
              >
                {mutation.saving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} 
                {mutation.saving ? 'Criando…' : 'Criar cotação'}
              </button>
            )}
          </footer>
        </main>
      </DialogContent>
    </Dialog>
  );
}

function DataStep({
  draft,
  requesters,
  loading,
  loadError,
  onReload,
  patch,
}: {
  draft: Draft;
  requesters: Signature[];
  loading: boolean;
  loadError: string;
  onReload: () => Promise<void>;
  patch: (value: Partial<Draft>) => void;
}) {
  return (
    <section>
      <header>
        <CalendarDays size={20}/>
        <div>
          <h3>Dados da cotação</h3>
          <p>A numeração será criada automaticamente quando a cotação for salva.</p>
        </div>
      </header>
      <div className="quote-form-grid">
        <Field label="Data da cotação *">
          <input autoFocus type="date" value={draft.requestDate} onChange={event => patch({requestDate: event.target.value})}/>
        </Field>
        <Field label="Número da cotação">
          <input value="Gerado automaticamente" disabled aria-describedby="quote-number-help"/>
          <small id="quote-number-help" className="quote-field-help">Exemplo: COT-001</small>
        </Field>
      </div>
      {loading ? (
        <Load text="Carregando solicitantes…"/>
      ) : loadError ? (
        <Failure message={loadError} reload={onReload}/>
      ) : !requesters.length ? (
        <div className="company-empty">
          <Users size={24}/>
          <h3>Nenhum solicitante cadastrado</h3>
          <p>Cadastre uma assinatura com a função Solicitante para continuar.</p>
          <ModuleLink className="btn" href="/cadastro?secao=assinaturas">Abrir assinaturas</ModuleLink>
        </div>
      ) : (
        <Field label="Solicitante *">
          <select
            value={draft.requesterId}
            onChange={event => {
              const selected = requesters.find(item => item.id === event.target.value);
              patch({requesterId: event.target.value, requester: selected?.name ?? ''});
            }}
          >
            <option value="">Selecione uma assinatura</option>
            {requesters.map(requester => <option key={requester.id} value={requester.id}>{requester.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Observações gerais">
        <textarea
          rows={5}
          maxLength={2000}
          value={draft.notes}
          onChange={event => patch({notes: event.target.value})}
          placeholder="Prazo, condição de entrega ou orientações"
        />
      </Field>
    </section>
  );
}

function MaterialsStep({
  materials,
  loading,
  loadError,
  items,
  onReload,
  onAdd,
  onRemove,
  onChange,
}: {
  materials: Material[];
  loading: boolean;
  loadError: string;
  items: QuoteItem[];
  onReload: () => Promise<void>;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, value: Partial<QuoteItem>) => void;
}) {
  const options = quoteMaterialOptions(materials);
  return (
    <section>
      <header>
        <PackagePlus size={20}/>
        <div>
          <h3>Materiais solicitados</h3>
          <p>Escolha o produto; as referências equivalentes cadastradas seguirão juntas para o prestador.</p>
        </div>
        <button className="btn company-primary" type="button" onClick={onAdd} disabled={!options.length}>
          <Plus size={16}/>Adicionar material
        </button>
      </header>
      {loading ? (
        <Load text="Carregando materiais…"/>
      ) : loadError ? (
        <Failure message={loadError} reload={onReload}/>
      ) : !options.length ? (
        <div className="company-empty">
          <ClipboardList size={24}/>
          <h3>Nenhum material cadastrado</h3>
          <p>Abra Materiais e cadastre um produto para continuar.</p>
          <ModuleLink className="btn" href="/cadastro?secao=materiais">Abrir materiais</ModuleLink>
        </div>
      ) : (
        <div className="quote-item-list">
          {items.map((item, index) => (
            <article className="quote-item" key={item.id}>
              <b>{index + 1}</b>
              <div className="quote-item-fields">
                <QuoteMaterialPicker
                  materials={options}
                  value={item.materialId}
                  itemNumber={index + 1}
                  onChange={materialId => onChange(item.id, {materialId})}
                />
                <div className="quote-item-secondary">
                  <Field label={`Quantidade${item.unit ? ` (${item.unit})` : ''} *`}>
                    <input inputMode="decimal" value={item.quantity} onChange={event => onChange(item.id, {quantity: event.target.value})}/>
                  </Field>
                  <Field label="Observação">
                    <input value={item.notes} onChange={event => onChange(item.id, {notes: event.target.value})}/>
                  </Field>
                </div>
              </div>
              <button
                className="icon-btn"
                type="button"
                disabled={items.length === 1}
                onClick={() => onRemove(item.id)}
                aria-label={`Remover item ${index + 1}`}
              >
                <Trash2 size={16}/>
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ProvidersStep({
  providers,
  loading,
  loadError,
  selected,
  onReload,
  onToggle,
}: {
  providers: ServiceProvider[];
  loading: boolean;
  loadError: string;
  selected: QuoteProvider[];
  onReload: () => Promise<void>;
  onToggle: (provider: ServiceProvider) => void;
}) {
  const [search, setSearch] = useState('');
  const normalize = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
  const value = normalize(search);
  const documentDigits = search.replace(/\D/g, '');
  const filtered = providers.filter(provider => {
    const searchable = normalize([
      provider.legalName,
      provider.tradeName,
      provider.document,
      providerDocument(provider),
    ].join(' '));
    return searchable.includes(value)
      || (documentDigits.length > 2 && provider.document.includes(documentDigits));
  });
  return (
    <section>
      <header>
        <Users size={20}/>
        <div>
          <h3>Selecione os prestadores</h3>
          <p>Ao criar, cada selecionado terá seu próprio PDF e sua coluna para lançar os preços.</p>
        </div>
        <span>{selected.length} selecionado(s)</span>
      </header>
      {loading ? (
        <Load text="Carregando prestadores…"/>
      ) : loadError ? (
        <Failure message={loadError} reload={onReload}/>
      ) : !providers.length ? (
        <div className="company-empty">
          <Users size={24}/>
          <h3>Nenhum prestador cadastrado</h3>
          <ModuleLink className="btn" href="/cadastro?secao=prestadores">Abrir prestadores</ModuleLink>
        </div>
      ) : (
        <>
          <LocalSearch
            value={search}
            onChange={setSearch}
            placeholder="Buscar por razão social, nome fantasia, CPF ou CNPJ"
          />
          {filtered.length ? (
            <div className="quote-provider-table-wrap">
              <table className="quote-provider-table">
                <caption className="sr-only">Prestadores disponíveis para esta cotação</caption>
                <thead>
                  <tr>
                    <th className="quote-provider-select-heading" scope="col">Selecionar</th>
                    <th scope="col">Prestador</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(provider => {
                    const active = selected.some(item => item.providerId === provider.id);
                    const inputId = `quote-provider-${provider.id}`;
                    const tradeLabel = provider.documentType === 'CNPJ' ? 'Nome fantasia' : 'Nome profissional';
                    return (
                      <tr key={provider.id} className={active ? 'selected' : ''}>
                        <td className="quote-provider-select-cell">
                          <label htmlFor={inputId} aria-label={`${active ? 'Remover' : 'Selecionar'} ${provider.legalName}`}>
                            <input
                              id={inputId}
                              type="checkbox"
                              checked={active}
                              onChange={() => onToggle(provider)}
                            />
                            <span className="quote-provider-check"><Check size={14}/></span>
                          </label>
                        </td>
                        <td>
                          <label className="quote-provider-copy" htmlFor={inputId}>
                            <strong className="quote-provider-name">{provider.legalName}</strong>
                            <span className="quote-provider-meta">
                              <span className="quote-provider-document">
                                {provider.documentType}: {providerDocument(provider)}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="quote-provider-trade">
                                {tradeLabel}: {provider.tradeName || 'Não informado'}
                              </span>
                            </span>
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="client-loading"><Users size={18}/>Nenhum prestador encontrado.</div>
          )}
        </>
      )}
    </section>
  );
}

function ReviewStep({draft, materials, onEdit}: {draft: Draft; materials: Material[]; onEdit: (step: number) => void}) {
  return (
    <section className="quote-review-step">
      <header>
        <ClipboardCheck size={21}/>
        <div>
          <h3>Resumo da cotação</h3>
          <p>Revise os dados, materiais e destinatários. Você ainda pode voltar e ajustar qualquer etapa.</p>
        </div>
        <span className="quote-review-ready"><Check size={14}/>Pronto para criar</span>
      </header>

      <div className="quote-review-grid">
        <article className="quote-review-card quote-review-data-card">
          <ReviewCardHeader step="1" title="Dados da cotação" description="Identificação e solicitante" onEdit={() => onEdit(0)}/>
          <dl className="quote-review-data-list">
            <div><dt>Número</dt><dd>Automático</dd></div>
            <div><dt>Data</dt><dd>{dateLabel(draft.requestDate)}</dd></div>
            <div><dt>Solicitante</dt><dd>{draft.requester}</dd></div>
          </dl>
          <div className="quote-review-note">
            <span>Observações gerais</span>
            <p>{draft.notes || 'Nenhuma observação informada.'}</p>
          </div>
        </article>

        <article className="quote-review-card quote-review-providers-card">
          <ReviewCardHeader step="3" title="Prestadores" description={`${draft.providers.length} selecionado(s)`} onEdit={() => onEdit(2)}/>
          <div className="quote-review-provider-grid">
            {draft.providers.map(provider => (
              <div className="quote-review-provider" key={provider.providerId}>
                <span className="quote-review-provider-icon"><Users size={16}/></span>
                <span>
                  <strong>{provider.providerName}</strong>
                  <small>{[provider.providerEmail, provider.providerPhone].filter(Boolean).join(' · ') || 'Contato não cadastrado'}</small>
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="quote-review-card quote-review-materials-card">
          <ReviewCardHeader step="2" title="Materiais" description={`${draft.items.length} item(ns) solicitado(s)`} onEdit={() => onEdit(1)}/>
          <div className="quote-review-material-list">
            {draft.items.map((item, index) => {
              const material = materials.find(entry => entry.id === item.materialId);
              const references = item.materialReferences
                .map(reference => [reference.brand, reference.code].filter(Boolean).join(' '))
                .join(' · ');
              return (
                <div className="quote-review-material-row" key={item.id}>
                  <span className="quote-review-material-index">{index + 1}</span>
                  <div className="quote-review-material-product">
                    {material ? (
                      <MaterialThumbnail material={material}/>
                    ) : (
                      <span className="quote-material-thumbnail" aria-hidden="true"><PackageOpen size={23}/></span>
                    )}
                    <span className="quote-review-material-copy">
                      <strong>{item.materialName}</strong>
                      <span><small>Referências</small>{references || 'Nenhuma referência cadastrada'}</span>
                      <span><small>Código interno</small>{material?.internalCode || 'Não informado'}</span>
                    </span>
                  </div>
                  <dl className="quote-review-material-meta">
                    <div><dt>Quantidade</dt><dd>{item.quantity} {item.unit}</dd></div>
                    <div><dt>Observação</dt><dd>{item.notes || 'Sem observação'}</dd></div>
                  </dl>
                </div>
              );
            })}
          </div>
        </article>
      </div>

      <div className="quote-review-final-note">
        <ClipboardCheck size={20}/>
        <div>
          <strong>O que acontece depois?</strong>
          <p>
            A cotação receberá um número automático. Depois, você poderá gerar um PDF individual para cada
            prestador e preencher os valores recebidos para comparar o vencedor.
          </p>
        </div>
      </div>
    </section>
  );
}

function ReviewCardHeader({step, title, description, onEdit}: {step: string; title: string; description: string; onEdit: () => void}) {
  return (
    <header className="quote-review-card-header">
      <span className="quote-review-card-step">{step}</span>
      <span className="quote-review-card-title"><strong>{title}</strong><small>{description}</small></span>
      <button className="btn small quote-review-edit" type="button" onClick={onEdit}><Pencil size={14}/>Editar</button>
    </header>
  );
}

function Load({text}: {text: string}) {
  return <div className="client-loading" role="status"><Loader2 className="animate-spin" size={19}/>{text}</div>;
}

function Failure({message, reload}: {message: string; reload: () => Promise<void>}) {
  return (
    <div className="company-empty" role="alert">
      <p>{message}</p>
      <button className="btn" type="button" onClick={() => void reload()}><RefreshCw size={16}/>Tentar novamente</button>
    </div>
  );
}
