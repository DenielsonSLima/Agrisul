import {drawReportPdfHeader,type ReportPdfImage} from '@/shared/reporting/pdfHeader';
import {drawReportPdfWatermark} from '@/shared/reporting/pdfWatermark';
import {formatReportCnpj} from '@/shared/reporting/companyBrand';
import {REPORT_MARGIN_MM} from '@/shared/reporting/reportLayout';
import type {ReportPdfBrand} from '@/shared/reporting/types';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {supplierNotes} from '@/shared/reporting/supplierText';
import {dateLabel,moneyLabel} from '@/shared/utils/presentation';
import type {jsPDF as JsPdf} from 'jspdf';
import type {PurchaseOrder} from '../types';

export type PurchaseOrderSnapshot=PurchaseOrder;

export function createPurchaseOrderSnapshot(order:PurchaseOrder):PurchaseOrderSnapshot{
  return structuredClone(order);
}

const safeFilePart=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'pedido';
const limitedLines=(doc:JsPdf,value:string,width:number,limit:number)=>{const lines=doc.splitTextToSize(value,width) as string[];if(lines.length<=limit)return lines;const visible=lines.slice(0,limit),last=visible[limit-1]?.replace(/[.\s]+$/,'')??'';visible[limit-1]=`${last}...`;return visible;};
function supplierDocument(order:PurchaseOrderSnapshot){const value=order.providerDocument.trim(),digits=value.replace(/\D/g,'');if(order.providerDocumentType==='CPF')return digits.length===11?digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4'):value||'Não informado';return value?formatReportCnpj(value):'Não informado';}
async function itemImages(order:PurchaseOrderSnapshot){const cache=new Map<string,ReportPdfImage|null>();const urls=[...new Set(order.items.map(item=>item.materialImageUrl).filter((url):url is string=>!!url))];for(let index=0;index<urls.length;index+=4){const batch=urls.slice(index,index+4),images=await Promise.all(batch.map(url=>loadReportImage(url,{maxWidth:360,maxHeight:360,quality:.86}).catch(()=>null)));batch.forEach((url,i)=>cache.set(url,images[i]));}return order.items.map(item=>item.materialImageUrl?cache.get(item.materialImageUrl)??null:null);}

export async function createPurchaseOrderPdf(order:PurchaseOrderSnapshot,brand:ReportPdfBrand){
  const {jsPDF}=await import('@/shared/reporting/jsPdfRuntime');
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight(),margin=REPORT_MARGIN_MM,content=width-margin*2,bottom=height-margin-9;
  const [logo,watermark,images]=await Promise.all([loadReportImage(brand.company?.logoUrl??null),loadReportImage(brand.watermark.imageUrl),itemImages(order)]);
  const addHeader=(continuation=false)=>{drawReportPdfWatermark(doc,width,height,brand.watermark,watermark);return drawReportPdfHeader({doc,pageWidth:width,margin,orientation:'portrait',settings:brand.header,company:brand.company,logo,title:continuation?'Pedido de compra · continuação':'Pedido de compra'})+4;};
  let y=addHeader();
  type Field={label:string;value:string;offset:number;width:number};
  const fieldLines=(field:Field)=>{
    doc.setFont('helvetica','bold');doc.setFontSize(8);
    return limitedLines(doc,field.value||'Não informado',field.width,2);
  };
  const drawFields=(fields:Field[],top:number)=>{
    let rowHeight=8.5;
    for(const field of fields){
      const lines=fieldLines(field),x=margin+field.offset;
      doc.setFont('helvetica','normal');doc.setFontSize(6.2);doc.setTextColor(120,136,125);
      doc.text(field.label.toUpperCase(),x,top);
      doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(48,78,57);
      doc.text(lines,x,top+3.7,{lineHeightFactor:1.1});
      rowHeight=Math.max(rowHeight,8.5+(lines.length-1)*3.1);
    }
    return rowHeight;
  };
  const drawFieldBlock=(rows:Field[][],fill:[number,number,number]|null,gap=3)=>{
    const rowHeights=rows.map(fields=>Math.max(...fields.map(field=>8.5+(fieldLines(field).length-1)*3.1)));
    const blockHeight=4+rowHeights.reduce((sum,rowHeight)=>sum+rowHeight,0);
    if(fill){doc.setFillColor(...fill);doc.roundedRect(margin,y,content,blockHeight,1.2,1.2,'F');}
    else{doc.setDrawColor(216,228,220);doc.roundedRect(margin,y,content,blockHeight,1.2,1.2);}
    let top=y+4;
    for(const fields of rows)top+=drawFields(fields,top);
    y+=blockHeight+gap;
  };
  const drawSummary=()=>drawFieldBlock([[
    {label:'Pedido',value:order.number,offset:4,width:33},
    {label:'Cotação',value:order.quotationNumber,offset:41,width:31},
    {label:'Ordem de compra',value:order.purchaseOrderNumber||'Não informada',offset:76,width:55},
    {label:'Data da cotação',value:dateLabel(order.requestDate),offset:135,width:content-139},
  ]],[242,247,243]);
  const drawSupplier=()=>{
    const rows:Field[][]=[[
      {label:order.providerDocumentType==='CPF'?'Fornecedor · Nome':'Fornecedor · Razão social',value:order.providerLegalName,offset:4,width:117},
      {label:order.providerDocumentType||'Documento',value:supplierDocument(order),offset:125,width:content-129},
    ]];
    const generalContact=[order.providerPhone,order.providerEmail].filter(Boolean).join(' · ');
    if(order.providerTradeName||generalContact){
      rows.push([
        ...(order.providerTradeName?[{label:order.providerDocumentType==='CPF'?'Nome profissional':'Nome fantasia',value:order.providerTradeName,offset:4,width:generalContact?82:content-8}]:[]),
        ...(generalContact?[{label:'Contato geral',value:generalContact,offset:order.providerTradeName?90:4,width:order.providerTradeName?content-94:content-8}]:[]),
      ]);
    }
    if(order.providerContactName||order.providerContactPhone){
      rows.push([
        ...(order.providerContactName?[{label:'Responsável',value:order.providerContactName,offset:4,width:order.providerContactPhone?82:content-8}]:[]),
        ...(order.providerContactPhone?[{label:'Contato do responsável',value:order.providerContactPhone,offset:order.providerContactName?90:4,width:order.providerContactName?content-94:content-8}]:[]),
      ]);
    }
    drawFieldBlock(rows,null);
  };
  const drawCommercial=()=>drawFieldBlock([[
    {label:'Forma de pagamento',value:order.paymentMethod||'Não informada',offset:4,width:86},
    {label:'Situação',value:order.status==='finished'?'Finalizado':'Em aberto',offset:94,width:42},
    {label:'Valor total',value:moneyLabel(order.total),offset:140,width:content-144},
  ]],[231,243,235],4);
  const drawTableHeader=()=>{doc.setFillColor(226,238,230);doc.rect(margin,y,content,9,'F');doc.setFont('helvetica','bold');doc.setFontSize(6.2);doc.setTextColor(53,84,62);[['Foto',12],['Produto',35],['Qtd.',116],['Unit. bruto',143],['Total líquido',174]].forEach(([label,x])=>doc.text(String(label),margin+Number(x),y+5,{align:Number(x)>100?'center':'left'}));y+=9;};
  const drawImage=(image:ReportPdfImage,x:number,top:number,w:number,h:number)=>{let iw=w,ih=iw/image.ratio;if(ih>h){ih=h;iw=ih*image.ratio;}doc.addImage(image.bytes,image.format,x+(w-iw)/2,top+(h-ih)/2,iw,ih,undefined,'FAST');};
  const newPage=()=>{doc.addPage();y=addHeader(true);drawTableHeader();};
  drawSummary();drawSupplier();drawCommercial();
  doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(48,75,57);doc.text(`Itens do pedido (${order.itemCount})`,margin,y);y+=4;drawTableHeader();
  order.items.forEach((item,index)=>{const row=26;if(y+row+(index===order.items.length-1?20:0)>bottom)newPage();const top=y;if(index%2===0){doc.setFillColor(249,251,249);doc.rect(margin,top,content,row,'F');}doc.setFillColor(243,247,244);doc.roundedRect(margin+2,top+2,21,row-4,1,1,'F');if(images[index])drawImage(images[index]!,margin+2.7,top+2.7,19.6,row-5.4);else{doc.setFont('helvetica','normal');doc.setFontSize(5);doc.setTextColor(150,163,154);doc.text('SEM FOTO',margin+12.5,top+14,{align:'center'});}doc.setFont('helvetica','bold');doc.setFontSize(7.4);doc.setTextColor(43,70,51);doc.text(limitedLines(doc,item.materialName,75,2),margin+27,top+5,{lineHeightFactor:1.1});const detail=[item.materialInternalCode&&`Cód.: ${item.materialInternalCode}`,item.materialReferences.map(reference=>[reference.brand,reference.code].filter(Boolean).join(' ')).filter(Boolean).join(' · '),supplierNotes(item.notes)].filter(Boolean).join(' · ');doc.setFont('helvetica','normal');doc.setFontSize(5.8);doc.setTextColor(100,118,106);if(detail)doc.text(limitedLines(doc,detail,75,3),margin+27,top+13,{lineHeightFactor:1.1});doc.setFontSize(6.8);doc.setTextColor(48,78,57);doc.text(`${item.quantity} ${item.unit}`,margin+116,top+14,{align:'center'});doc.text(moneyLabel(item.unitPrice),margin+143,top+14,{align:'center'});doc.setFont('helvetica','bold');doc.text(moneyLabel(item.lineTotal),width-margin-3,top+14,{align:'right'});doc.setDrawColor(220,229,223);doc.rect(margin,top,content,row);y+=row;});
  if(y+18>bottom)newPage();y+=5;doc.setFillColor(222,239,227);doc.roundedRect(width-margin-74,y,74,14,1.2,1.2,'F');doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(91,112,98);doc.text('TOTAL DO PEDIDO',width-margin-70,y+5);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(33,105,62);doc.text(moneyLabel(order.total),width-margin-4,y+10.5,{align:'right'});
  const pages=doc.getNumberOfPages(),issued=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(brand.issuedAt);for(let page=1;page<=pages;page++){doc.setPage(page);doc.setDrawColor(232,237,233);doc.line(margin,height-margin-3,width-margin,height-margin-3);doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(131,147,137);doc.text(`Emitido por ${brand.issuer.name} · ${issued}`,margin,height-margin);doc.text(`${page} / ${pages}`,width-margin,height-margin,{align:'right'});}
  return {doc,fileName:`pedido-${safeFilePart(order.number)}-${safeFilePart(order.providerLegalName)}.pdf`};
}
