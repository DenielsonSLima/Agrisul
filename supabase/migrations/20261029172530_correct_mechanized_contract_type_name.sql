BEGIN;

-- Correct only the identified registration and its own contract snapshots.
-- name_key is generated from name and follows this update automatically.
WITH corrected_type AS (
 UPDATE public.billing_contract_types
 SET name='MECANIZADO'
 WHERE id='3c6c1b60-a053-4a33-b8e8-47affdd5577b'::uuid AND name='MACANIZADO'
 RETURNING owner_id,id
)
UPDATE public.billing_contracts contract
SET type_name=regexp_replace(contract.type_name,'\mMACANIZADO\M','MECANIZADO','gi'),
 title=regexp_replace(contract.title,'\mMACANIZADO\M','MECANIZADO','gi')
FROM corrected_type target
WHERE contract.owner_id=target.owner_id AND contract.type_id=target.id
 AND (contract.type_name ~* '\mMACANIZADO\M' OR contract.title ~* '\mMACANIZADO\M');

COMMIT;
