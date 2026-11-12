import {dateLabel} from '@/shared/utils/presentation';
import type {OvertimeReport,OvertimeRow} from '../types';
import {dailyClockLabel,dailyHoursLabel,dailyOvertimeCalendar,dailyReasonLabel} from '../reporting/dailyOvertimePresentation';
import './dailyOvertimeSheet.css';

// Export preview only. The entry form uses the daily table rather than this document model.
export function DailyOvertimeSheet({report,row}:{report:OvertimeReport;row:OvertimeRow}){
 const daily=row.daily;
 return <div className="daily-overtime-sheet-wrap"><article className="daily-overtime-sheet" aria-label={'Prévia do informativo de horas extras de '+row.employeeName}>
  <h3>INFORMATIVO DE HORAS EXTRAS</h3>
  <p>PERÍODO: {dateLabel(report.dateFrom)} A {dateLabel(report.dateTo)}</p>
  <p>FUNCIONÁRIO: {row.employeeName} <span>MATRÍCULA: {row.registrationNumber}</span></p>
  <p>ATIVIDADE: {daily?.activity||'____________________________'} <span>SETOR: {daily?.sector||report.sector||'____________________'}</span></p>
  <table><colgroup>{[4.5,8,8,8,8,9,9,33,12.5].map((value,index)=><col key={index} style={{width:value+'%'}}/>)}</colgroup>
   <thead><tr><th rowSpan={2} scope="col">DIA</th><th colSpan={4} scope="colgroup">HORA</th><th colSpan={2} scope="colgroup">TOTAL</th><th rowSpan={2} scope="col">MOTIVO DA HORA EXTRA</th><th rowSpan={2} scope="col">VISTO</th></tr>
    <tr><th scope="col">INICIAL</th><th scope="col">SAÍDA</th><th scope="col">ENTRADA</th><th scope="col">FINAL</th><th scope="col" className="daily-overtime-rate">50%</th><th scope="col" className="daily-overtime-rate">100%</th></tr></thead>
   <tbody>{dailyOvertimeCalendar(report.dateFrom,report.dateTo,daily?.entries??[]).map(({date,entry,rowKey})=><tr key={rowKey}>
    <th scope="row" title={dateLabel(date)}>{Number(date.slice(8))}</th><td>{dailyClockLabel(entry?.startTime)}</td><td>{dailyClockLabel(entry?.breakStart)}</td><td>{dailyClockLabel(entry?.breakEnd)}</td><td>{dailyClockLabel(entry?.endTime)}</td><td>{dailyHoursLabel(entry?.hours50)}</td><td>{dailyHoursLabel(entry?.hours100)}</td><td className="daily-overtime-reason">{dailyReasonLabel(entry)}</td><td>{entry?.approval}</td>
   </tr>)}</tbody>
   <tfoot>{daily?.adjustment&&<tr><td colSpan={9}>AJUSTE DO RESUMO: 50% {daily.adjustment.hours50} | 100% {daily.adjustment.hours100} — Motivo: {daily.adjustment.reason}</td></tr>}
    {row.source==='legacy'&&!daily?.hasDailyEntries&&<tr><td colSpan={9}>Resumo anterior preservado. Este funcionário ainda não possui lançamentos diários neste período.</td></tr>}
    <tr><th colSpan={5} scope="row">TOTAL DE HORAS</th><td>{row.hours50}</td><td>{row.hours100}</td><td colSpan={2}/></tr></tfoot>
  </table>
 </article></div>;
}
