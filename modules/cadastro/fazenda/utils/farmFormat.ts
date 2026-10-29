export function formatHectares(value:string|null|undefined){
  if(value==null||value==='')return 'Não informada';
  const [whole,decimal]=value.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(decimal?','+decimal:'');
}
export function formatAreaHectares(value:string|null|undefined){
  return value==null||value===''?'Não informada':formatHectares(value)+' ha';
}
