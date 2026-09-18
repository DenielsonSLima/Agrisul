export function DashboardFilter({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  return <label className="inicio-month">Indicadores do mês<input type="month" min="1900-01" max="9998-12" value={value}
    onChange={event => {const next = event.target.value;if (/^\d{4}-(0[1-9]|1[0-2])$/.test(next) && next >= '1900-01' && next <= '9998-12') onChange(next);}}/></label>;
}
