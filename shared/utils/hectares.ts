// Integer millionths of a hectare keep additions and limit checks exact.
export const HECTARE_SCALE=1000000;
export function hectaresToUnits(value:string):number {
  const normalized=value.trim().replace(',','.');
  if(!/^\d{1,9}(\.\d{1,6})?$/.test(normalized))throw new Error('Informe uma área válida, com até seis casas decimais.');
  const [whole,decimal='']=normalized.split('.');
  return Number(whole)*HECTARE_SCALE+Number(decimal.padEnd(6,'0'));
}
export function unitsToHectares(units:number):string {
  const whole=Math.floor(units/HECTARE_SCALE);const decimal=String(units%HECTARE_SCALE).padStart(6,'0').replace(/0+$/,'');
  return String(whole)+(decimal?'.'+decimal:'');
}
