// Use only fixed application column expressions, never request input.
// Farms already store normalized decimal text; parse it without float rounding.
export function hectaresUnitsSql(column:string){
  return `(CAST(CASE WHEN instr(${column},'.')>0 THEN substr(${column},1,instr(${column},'.')-1) ELSE ${column} END AS INTEGER)*1000000 + CAST(substr((CASE WHEN instr(${column},'.')>0 THEN substr(${column},instr(${column},'.')+1) ELSE '' END)||'000000',1,6) AS INTEGER))`;
}
