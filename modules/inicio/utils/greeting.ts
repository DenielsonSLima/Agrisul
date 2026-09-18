export function greeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23'}).format(date));
  return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
}

export function workspaceDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export const workspaceDate = (day: string) => new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(`${day}T12:00:00`));
