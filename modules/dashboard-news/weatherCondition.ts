export type WeatherKind='clear'|'partly'|'cloud'|'rain'|'storm'|'fog'|'snow'|'unknown';
export function weatherCondition(condition:string){
 const text=condition.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const possible=/possibil|chance|probabil/.test(text);
 let kind:WeatherKind='unknown';
 if(!text||/indisponivel|nao definid|consultando/.test(text))return {kind,possible:false};
 if(/trovo|tempestade/.test(text)&&!/sem trovo/.test(text))kind='storm';
 else if(/chuva|pancada|chuvisco|garoa/.test(text)&&!/sem chuva/.test(text))kind='rain';
 else if(/neve|geada/.test(text))kind='snow';
 else if(/nevoeiro|nevoa|neblina/.test(text))kind='fog';
 else if(/parcial|poucas nuvens|algumas nuvens|nuvens dispersas|\bsol\b.*\bnuvens?\b|\bnuvens?\b.*\bsol\b/.test(text))kind='partly';
 else if(/muitas nuvens|nublado|encoberto/.test(text))kind='cloud';
 else if(/\b(?:claro|sol|limpo)\b/.test(text))kind='clear';
 return {kind,possible:possible&&(kind==='rain'||kind==='storm')};
}
