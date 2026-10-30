import {dateLabel} from '@/shared/utils/presentation';
import type {OvertimeReport} from '../types';

export function OvertimeSheet({report,companyName}:{report:OvertimeReport;companyName:string}){
 const month=report.referenceMonth.split('-').reverse().join('/');
 return <div className="overtime-sheet-wrap"><article className="overtime-sheet" aria-label="Prévia do relatório de horas extras">
  <header><strong className="overtime-sheet-brand">{companyName}</strong><h3>RELATÓRIO DE HORAS-EXTRAS REALIZADAS — SETOR: {report.sector||'________________'}</h3></header>
  <div className="overtime-sheet-period"><strong>PERÍODO {dateLabel(report.dateFrom)} A {dateLabel(report.dateTo)}</strong><strong>MÊS {month}</strong></div>
  <table><colgroup><col style={{width:'9%'}}/><col style={{width:'33%'}}/><col style={{width:'26%'}}/><col style={{width:'16%'}}/><col style={{width:'16%'}}/></colgroup><thead><tr><th rowSpan={2} scope="col">Mat.</th><th rowSpan={2} scope="col">Funcionário</th><th rowSpan={2} scope="col">Cargo</th><th colSpan={2} scope="colgroup">QUANTIDADE HORAS EXTRAS</th></tr><tr className="overtime-rate-row"><th scope="col">50%</th><th scope="col">100%</th></tr></thead><tbody>{report.rows.map(row=><tr key={row.employeeId}><td>{row.registrationNumber}</td><td>{row.employeeName}</td><td>{row.jobTitle}</td><td>{row.hours50==='00:00:00'?'':row.hours50}</td><td>{row.hours100==='00:00:00'?'':row.hours100}</td></tr>)}{Array.from({length:Math.max(0,20-report.rows.length)},(_,index)=><tr className="overtime-blank-row" key={'blank-'+index} aria-hidden="true"><td>&nbsp;</td><td/><td/><td/><td/></tr>)}</tbody><tfoot><tr><th colSpan={3} scope="row">TOTAL DE HORAS</th><td>{report.total50}</td><td>{report.total100}</td></tr></tfoot></table>
  <footer><span>COORD. DO SETOR</span><span>DIRETOR DA UNIDADE</span></footer>
 </article></div>;
}
