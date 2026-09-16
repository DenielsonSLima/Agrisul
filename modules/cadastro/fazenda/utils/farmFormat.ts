export function formatHectares(value:string){
  const [whole,decimal]=value.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(decimal?','+decimal:'');
}
