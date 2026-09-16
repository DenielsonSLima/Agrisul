export function searchString(params:Record<string,string|string[]|undefined>={}) {
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(params)) {
    if(Array.isArray(value)) value.forEach(item=>query.append(key,item));
    else if(value!==undefined) query.set(key,value);
  }
  return query.size ? "?"+query.toString() : "";
}
