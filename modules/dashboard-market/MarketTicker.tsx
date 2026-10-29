'use client';
import {useEffect,useId,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {AlertTriangle,Info,Pause,Play,Plus,RefreshCw,TrendingUp,X} from 'lucide-react';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {notifications} from '@/shared/feedback';
import {defaultMarketIds,marketCatalog,readMarketSelection,type MarketId,type MarketQuote} from './catalog';
import {DEFAULT_TICKER_SPEED,marketDirection,readTickerSpeed} from './tickerMotion.mjs';
import {useTickerMotion} from './useTickerMotion';
import {useMarketFeed} from './useMarketFeed';

const priceFormat=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const exchangeFormat=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4});
const marketPrice=(id:MarketId,value:string)=>(id==='usd'||id==='eur'?exchangeFormat:priceFormat).format(Number(value));
const changeFormat=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'exceptZero'});
const observedFormat=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'});
const dateLabel=(value:string|null)=>value?value.split('-').reverse().join('/'):'Sem publicação';
const publication=(quote:MarketQuote|undefined)=>quote?.observedAt?`${observedFormat.format(new Date(quote.observedAt))} (Brasília)`:dateLabel(quote?.date??null);
const selectionEvent='billing:dashboard-market-selection';
function subscribeSelection(changed:()=>void){
  window.addEventListener('storage',changed);window.addEventListener(selectionEvent,changed);
  return()=>{window.removeEventListener('storage',changed);window.removeEventListener(selectionEvent,changed);};
}
const readSelection=(key:string)=>{try{return localStorage.getItem(key);}catch{return null;}};

export function MarketTicker({actions}:{actions?:ReactNode}){
  const {user}=useAuth();
  return user?<MarketTickerForUser key={user.id} userId={user.id} actions={actions}/>:null;
}
function MarketTickerForUser({userId,actions}:{userId:string;actions?:ReactNode}){
  const panelId=useId(),titleId=useId(),storageKey=`billing:dashboard-market:v1:${userId}`;
  const rootRef=useRef<HTMLElement>(null),addRef=useRef<HTMLButtonElement>(null),infoRef=useRef<HTMLButtonElement>(null);
  const savedSelection=useSyncExternalStore(subscribeSelection,()=>readSelection(storageKey),()=>null);
  const speedKey=`${storageKey}:speed`;
  const savedSpeed=useSyncExternalStore(subscribeSelection,()=>readSelection(speedKey),()=>null);
  const selected=readMarketSelection(savedSelection);
  const persistedSpeed=readTickerSpeed(savedSpeed);
  const [speedDraft,setSpeedDraft]=useState<number|null>(null);
  const speed=speedDraft??persistedSpeed;
  const [draft,setDraft]=useState<MarketId[]>(defaultMarketIds);
  const [panel,setPanel]=useState<'selection'|'details'|null>(null);
  const [paused,setPaused]=useState(false),[saveError,setSaveError]=useState('');
  const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
  useEffect(()=>{
    if(!panel)return;
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!rootRef.current?.contains(event.target))setPanel(null);};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[panel]);
  const query=useMarketFeed(userId);
  const {viewportRef,trackRef,repeats,reducedMotion}=useTickerMotion(selected.length,speed,paused||hovered||focused||panel!==null||query.isPending);
  const items=marketCatalog.filter(item=>selected.includes(item.id));
  const hasStale=items.some(item=>query.data?.quotes.some(quote=>quote.id===item.id&&quote.status==='stale'));
  const hasUnavailable=items.some(item=>query.data?.quotes.some(quote=>quote.id===item.id&&quote.status==='unavailable'));
  const marketWarning=query.isError||hasStale||hasUnavailable;
  const close=()=>{const trigger=panel==='selection'?addRef:infoRef;setPanel(null);trigger.current?.focus();};
  const save=()=>{
    if(!draft.length)return;
    try{localStorage.setItem(storageKey,JSON.stringify(draft));window.dispatchEvent(new Event(selectionEvent));setSaveError('');close();notifications.saved('Indicadores do Dashboard salvos neste navegador.');}
    catch{setSaveError('Não foi possível salvar neste navegador.');notifications.error('Não foi possível salvar os indicadores.');}
  };
  const saveSpeed=(value:number)=>{
    const next=readTickerSpeed(String(value));
    if(next===persistedSpeed){setSpeedDraft(null);return;}
    try{localStorage.setItem(speedKey,String(next));window.dispatchEvent(new Event(selectionEvent));setSpeedDraft(null);setSaveError('');notifications.saved('Velocidade da faixa salva neste navegador.');}
    catch{setSaveError('Não foi possível salvar a velocidade neste navegador.');notifications.error('Não foi possível salvar a velocidade da faixa.');}
  };
  const remove=(id:MarketId)=>{
    if(selected.length<=1)return;
    const next=selected.filter(item=>item!==id);
    try{localStorage.setItem(storageKey,JSON.stringify(next));window.dispatchEvent(new Event(selectionEvent));setDraft(next);setSaveError('');notifications.saved('Indicador removido da faixa. Você pode adicioná-lo novamente.');requestAnimationFrame(()=>rootRef.current?.querySelector<HTMLButtonElement>('[data-remove-market]:not(:disabled)')?.focus());}
    catch{setSaveError('Não foi possível remover o indicador neste navegador.');notifications.error('Não foi possível salvar os indicadores.');}
  };
  return <section className="market-ticker" aria-label="Cotações e referências de mercado" ref={rootRef}>
    <div className="market-ticker-bar">
      <div className="market-ticker-label"><TrendingUp size={14}/><strong>Mercado</strong></div>
      <div ref={viewportRef} className={`market-ticker-window${reducedMotion?' is-reduced-motion':''}`} data-speed={speed} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false);}}>
        <div className="market-ticker-track" ref={trackRef}>
          {[0,1].map(copy=><ul className="market-ticker-items" key={copy} aria-hidden={copy===1?true:undefined} inert={copy===1?true:undefined}>
            {Array.from({length:repeats},(_,repeat)=>items.map(item=>{
              const quote=query.data?.quotes.find(value=>value.id===item.id);
              const available=quote!==undefined&&quote.status!=='unavailable'&&quote.value!==null;
              const stale=quote?.status==='stale';
              const displayValue=available?marketPrice(item.id,quote.value!):query.isQuotePending(item.id)?'…':'Sem cotação';
              const change=quote?.changePercent;
              const hasChange=typeof change==='string'&&change.trim()!==''&&Number.isFinite(Number(change));
              const description=`${item.name}: ${displayValue} ${item.unit}.${hasChange?` Variação: ${changeFormat.format(Number(change))}%.`:''} ${item.description}. ${quote?.note??'Consultando a fonte'}. Fonte: ${quote?.source??'aguardando consulta'}. Publicação: ${publication(quote)}.${stale?' Atualização indisponível; última referência preservada.':''}`;
              const direction=marketDirection(quote?.changePercent);
              return <li data-market-id={item.id} className={`market-ticker-item${stale?' is-stale':''}`} key={`${repeat}:${item.id}`} aria-hidden={repeat>0?true:undefined} inert={repeat>0?true:undefined}><a href={quote?.sourceUrl??undefined} target="_blank" rel="noopener noreferrer" tabIndex={-1} title={description} aria-label={description}>
                <span className="market-ticker-name">{item.name}</span>
                <span className="market-ticker-quote"><strong className={`market-ticker-value is-${direction}`}>{displayValue}</strong><small className="market-ticker-unit">{item.unit}</small></span>
                {hasChange?<span className={`market-ticker-change is-${direction}`}>{direction!=='neutral'&&<span className="market-ticker-direction" aria-hidden="true">{direction==='up'?'▲':'▼'}</span>}{changeFormat.format(Number(change))}%</span>:null}
                {stale?<AlertTriangle className="market-ticker-stale" size={12} aria-hidden="true"/>:null}
              </a></li>;
            }))}
          </ul>)}
        </div>
      </div>
      <div className="market-ticker-tools">
        <button className="market-ticker-control market-ticker-pause" type="button" aria-label={paused?'Retomar faixa de cotações':'Pausar faixa de cotações'} title={paused?'Retomar cotações':'Pausar movimento'} aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={14}/>:<Pause size={14}/>}</button>
        <button ref={infoRef} className={`market-ticker-control${marketWarning?' has-warning':''}`} type="button" aria-label={marketWarning?'Fontes de mercado: algumas atualizações estão indisponíveis':'Consultar fontes, datas e horários das cotações'} title={marketWarning?'Últimas referências preservadas. Ver fontes e horários':'Fontes e horários'} aria-expanded={panel==='details'} aria-controls={panelId} onClick={()=>setPanel(previous=>previous==='details'?null:'details')}>{marketWarning?<AlertTriangle size={14}/>:<Info size={14}/>}</button>
        <button ref={addRef} className="market-ticker-add" type="button" aria-label="Adicionar indicadores à faixa" title="Adicionar indicadores" aria-expanded={panel==='selection'} aria-controls={panelId} onClick={()=>{setDraft(selected);setPanel(previous=>previous==='selection'?null:'selection');}}><Plus size={14}/><span>Adicionar</span></button>
        {actions?<div className="market-ticker-extra" onClickCapture={()=>setPanel(null)}>{actions}</div>:null}
      </div>
    </div>
    {panel?<div id={panelId} className="market-ticker-panel" role="region" aria-labelledby={titleId} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}>
      <div className="market-ticker-panel-header"><h2 id={titleId}>Mercado</h2><div><button type="button" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw size={13} className={query.isFetching?'market-spin':''}/>{query.isFetching?'Consultando':'Atualizar'}</button><button className="market-ticker-control" type="button" aria-label="Fechar painel de mercado" autoFocus onClick={close}><X size={16}/></button></div></div>
      <div className="market-ticker-panel-tabs" aria-label="Conteúdo do painel de mercado"><button type="button" aria-pressed={panel==='selection'} onClick={()=>{setDraft(selected);setPanel('selection');}}>Indicadores</button><button type="button" aria-pressed={panel==='details'} onClick={()=>setPanel('details')}>Fontes e horários</button></div>
      <div className="market-ticker-speed"><label htmlFor={`${panelId}-speed`}>Velocidade da faixa <output>{speed} px/s</output></label><input id={`${panelId}-speed`} aria-label="Velocidade da faixa" type="range" min="20" max="140" step="10" value={speed} onChange={event=>setSpeedDraft(Number(event.target.value))} onPointerUp={event=>saveSpeed(Number(event.currentTarget.value))} onKeyUp={event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))saveSpeed(Number(event.currentTarget.value));}} onBlur={event=>{if(speedDraft!==null)saveSpeed(Number(event.currentTarget.value));}}/><div><span>Mais lenta</span><button type="button" onClick={()=>saveSpeed(DEFAULT_TICKER_SPEED)}>Padrão</button><span>Mais rápida</span></div></div>
      {saveError?<p role="alert">{saveError}</p>:null}
      {panel==='selection'?<>
        <fieldset><legend>Escolha os indicadores da faixa</legend><p>Preferências salvas neste navegador. Cada praça e fonte tem seu próprio período de publicação.</p>
          <div className="market-ticker-options">{marketCatalog.map(item=><label key={item.id}><input type="checkbox" checked={draft.includes(item.id)} onChange={event=>setDraft(previous=>event.target.checked?[...previous,item.id]:previous.filter(id=>id!==item.id))}/><span><strong>{item.name}</strong><small>{item.description}</small></span></label>)}</div>
        </fieldset>
        <div className="market-ticker-actions"><span>{draft.length?'':'Selecione ao menos um indicador.'}</span><button type="button" onClick={close}>Cancelar</button><button type="button" disabled={!draft.length} onClick={save}>Aplicar indicadores</button></div>
      </>:<div className="market-ticker-details"><p>Câmbio comercial com cache público de 1 minuto; se indisponível, referência diária alternativa. Agro: publicação diária por praça. Cana: projeção mensal da safra.</p>
        {marketWarning?<p className="market-ticker-warning" role="status">Algumas fontes não puderam ser atualizadas. Os últimos valores válidos mantêm a data original.</p>:null}
        <ul>{items.map(item=>{const quote=query.data?.quotes.find(value=>value.id===item.id);return <li key={item.id}><div><strong>{item.name}</strong><span>{quote?.value?`${marketPrice(item.id,quote.value)} ${item.unit}`:'Sem cotação'}</span></div><p>{item.description}</p><p>{quote?.note??'Aguardando consulta à fonte.'}{quote?.status==='stale'?' Última referência; atualização indisponível.':''}</p><div><a href={quote?.sourceUrl??undefined} target="_blank" rel="noopener noreferrer">{quote?.source??'Fonte indisponível'}</a><time dateTime={quote?.observedAt??quote?.date??undefined}>{publication(quote)}</time></div><button type="button" className="market-ticker-remove" data-remove-market={item.id} aria-label={`Remover ${item.name} da faixa`} title={selected.length===1?'Mantenha ao menos um indicador na faixa':`Remover ${item.name} da faixa`} disabled={selected.length===1} onClick={()=>remove(item.id)}><X size={12}/>Remover da faixa</button></li>;})}</ul>
        {query.data?.checkedAt?<p className="market-ticker-checked">Última consulta: {observedFormat.format(new Date(query.data.checkedAt))} (Brasília).</p>:null}
      </div>}
    </div>:null}
  </section>;
}
