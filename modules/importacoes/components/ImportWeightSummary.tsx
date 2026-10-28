'use client';
import {useState} from 'react';
import {dateLabel} from '@/shared/utils/presentation';
import type {ImportEquipmentWeightSummary,ImportTripWeightSummary,ImportWeightSummary as WeightSummary} from '../types';
import {importCount,importValue} from '../utils/presentation';

function WeightValue({value,missingCount}:{value:string|null;missingCount:number}){
 return <><span className="imports-weight-number">{value===null?'—':importValue({type:'decimal'},value)}{value!==null&&<small> t</small>}</span>{missingCount>0&&<small className="imports-weight-partial">Parcial · {importCount(missingCount)} lançamento(s) sem peso</small>}</>;
}

function EquipmentLabel({codes,status}:{codes:string[];status?:ImportEquipmentWeightSummary['status']}){
 if(status==='conflict')return <><span>Equipamentos divergentes</span>{codes.length>0&&<small className="imports-weight-detail">{codes.join(' · ')}</small>}</>;
 if(status==='missing'||!codes.length)return <span>Equipamento não informado</span>;
 return <span>{codes.join(' · ')}</span>;
}

function TripLabel({trip}:{trip:ImportTripWeightSummary}){
 if(!trip.linked)return <><span>Sem conjunto identificado</span><small className="imports-weight-detail">Lançamento avulso · não conta como viagem</small></>;
 return <><span>{trip.entryNumbers.length?`Entrada ${trip.entryNumbers.join(' · ')}`:trip.groupOrdinal===null?'Viagem sem número':`Conjunto ${importCount(trip.groupOrdinal)}`}</span>{trip.entryNumbers.length>0&&trip.groupOrdinal!==null&&<small className="imports-weight-detail">Conjunto {importCount(trip.groupOrdinal)}</small>}</>;
}

export function ImportWeightSummary({summary,updating=false}:{summary:WeightSummary;updating?:boolean}){
 const [view,setView]=useState<'equipment'|'trips'>('equipment');
 return <section className="imports-weight-summary" aria-labelledby="imports-weight-summary-title" aria-busy={updating}>
  <header className="imports-weight-heading"><div><h2 id="imports-weight-summary-title">Resumo dos lançamentos</h2><p>Pesos e viagens dos lançamentos visíveis. Este resumo aparece somente no sistema.</p></div>{updating&&<span className="imports-weight-updating" role="status">Atualizando resumo…</span>}</header>
  <dl className="imports-weight-cards">
   <div><dt>Peso bruto</dt><dd><WeightValue value={summary.grossWeight} missingCount={summary.grossMissingCount}/></dd></div>
   <div><dt>Peso líquido</dt><dd><WeightValue value={summary.netWeight} missingCount={summary.netMissingCount}/></dd></div>
   <div><dt>Viagens</dt><dd>{importCount(summary.tripCount)}</dd><small>Uma viagem por conjunto original</small></div>
   <div><dt>Equipamentos</dt><dd>{importCount(summary.equipmentCount)}</dd><small>Conjuntos identificados por equipamento</small></div>
  </dl>
  {summary.groupSizes.length>0&&<div className="imports-weight-group-sizes" aria-label="Quantidade de viagens por tamanho do conjunto">{summary.groupSizes.map(group=><span key={group.entryCount}><strong>{importCount(group.tripCount)}</strong> {group.tripCount===1?'viagem':'viagens'} com {importCount(group.entryCount)} {group.entryCount===1?'lançamento':'lançamentos'} por conjunto</span>)}</div>}
  <div className="imports-weight-toolbar"><div className="imports-weight-view" role="group" aria-label="Agrupamento do resumo"><button type="button" aria-pressed={view==='equipment'} onClick={()=>setView('equipment')}>Por equipamento</button><button type="button" aria-pressed={view==='trips'} onClick={()=>setView('trips')}>Por viagem</button></div><span>{importCount(summary.entryCount)} lançamentos no resumo</span></div>
  {summary.entryCount===0?<p className="imports-weight-empty">Nenhum lançamento neste filtro para resumir.</p>:<div className="imports-weight-table-wrap"><table className="imports-weight-table" aria-label={view==='equipment'?'Resumo de pesos e viagens por equipamento':'Resumo de pesos por viagem'}>
   <thead><tr>{view==='equipment'?<><th scope="col">Equipamento / conjunto</th><th scope="col" className="imports-weight-count">Viagens</th><th scope="col" className="imports-weight-count">Lançamentos</th></>:<><th scope="col">Viagem / entrada</th><th scope="col">Dia</th><th scope="col">Equipamento</th><th scope="col" className="imports-weight-count">Lançamentos</th></>}<th scope="col" className="imports-weight-total">Peso bruto</th><th scope="col" className="imports-weight-total">Peso líquido</th></tr></thead>
   <tbody>{view==='equipment'?summary.equipment.map(equipment=><tr key={equipment.key}><th scope="row"><EquipmentLabel codes={equipment.equipmentCodes} status={equipment.status}/></th><td className="imports-weight-count">{importCount(equipment.tripCount)}</td><td className="imports-weight-count">{importCount(equipment.entryCount)}</td><td className="imports-weight-total"><WeightValue value={equipment.grossWeight} missingCount={equipment.grossMissingCount}/></td><td className="imports-weight-total"><WeightValue value={equipment.netWeight} missingCount={equipment.netMissingCount}/></td></tr>):summary.trips.map(trip=><tr key={trip.key}><th scope="row"><TripLabel trip={trip}/></th><td>{dateLabel(trip.date)}</td><td><EquipmentLabel codes={trip.equipmentCodes}/></td><td className="imports-weight-count">{importCount(trip.entryCount)}{trip.partial&&<small className="imports-weight-partial">de {importCount(trip.totalEntryCount)} · parcial no filtro</small>}</td><td className="imports-weight-total"><WeightValue value={trip.grossWeight} missingCount={trip.grossMissingCount}/></td><td className="imports-weight-total"><WeightValue value={trip.netWeight} missingCount={trip.netMissingCount}/></td></tr>)}</tbody>
   <tfoot><tr><th scope="row" colSpan={view==='equipment'?1:3}>Total geral do filtro</th>{view==='equipment'&&<td className="imports-weight-count">{importCount(summary.tripCount)}</td>}<td className="imports-weight-count">{importCount(summary.entryCount)}</td><td className="imports-weight-total"><WeightValue value={summary.grossWeight} missingCount={summary.grossMissingCount}/></td><td className="imports-weight-total"><WeightValue value={summary.netWeight} missingCount={summary.netMissingCount}/></td></tr></tfoot>
  </table></div>}
  <footer className="imports-weight-notes"><p>Peso líquido = peso bruto − tara. As linhas de um mesmo conjunto são somadas e contam como uma única viagem. Os totais acompanham os filtros da tabela.</p>{summary.partialTripCount>0&&<p>{importCount(summary.partialTripCount)} viagem(ns) com parte dos lançamentos fora do filtro. Os pesos consideram somente as linhas visíveis.</p>}{summary.unlinkedEntryCount>0&&<p>{importCount(summary.unlinkedEntryCount)} lançamento(s) sem conjunto identificado; seus pesos entram no resumo, mas eles não aumentam a quantidade de viagens.</p>}</footer>
 </section>;
}
