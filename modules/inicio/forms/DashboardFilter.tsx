export function DashboardFilter({value,onChange}:{value:string;onChange:(value:string)=>void}) {
 return <label>Mês de referência<input type="month" value={value} onChange={event=>{if(event.target.value)onChange(event.target.value);}}/></label>;
}
