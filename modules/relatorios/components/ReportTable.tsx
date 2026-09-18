import {reportColumns} from '../catalog';
import {reportCell} from '../reporting/reportPresentation';
import type {ReportData} from '../types';
import {LoadReportTable} from './LoadReportTable';
export function ReportTable({data}: {data: ReportData}) {
  if(data.kind==='loads')return <LoadReportTable data={data}/>;
  const columns = reportColumns[data.kind];
  if (!data.rows.length) return <div className="company-empty"><h3>Nenhum registro neste relatório</h3><p>Consulte outro mês ou confira os cadastros da empresa.</p></div>;
  return <div className="reports-table-wrap"><table className="reports-table"><caption className="sr-only">Relatório de {data.kind}</caption><thead><tr>{columns.map(column => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{data.rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map(column => <td key={column.key}>{reportCell(row[column.key], column)}</td>)}</tr>)}</tbody></table></div>;
}
