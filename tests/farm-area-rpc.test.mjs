import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('optional farm area: persistence, decimal precision, plot capacity and account isolation',async()=>{
 const {db}=await createCaneWeighingDb();
 try{await db.exec(await readFile(new URL('../supabase/tests/farm_optional_area.sql',import.meta.url),'utf8'));}
 finally{await db.close();}
});
