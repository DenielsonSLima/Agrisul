-- Employees can be recorded before their official registration is assigned.
ALTER TABLE public.billing_employees DROP CONSTRAINT billing_employees_registration_number_check;
ALTER TABLE public.billing_employees ADD CONSTRAINT billing_employees_registration_number_check
 CHECK(length(btrim(registration_number))<=60);
DROP INDEX public.billing_employees_owner_registration;
CREATE UNIQUE INDEX billing_employees_owner_registration
 ON public.billing_employees(owner_id,lower(registration_number)) WHERE registration_number<>'';

DO $migration$
DECLARE definition text:=pg_get_functiondef('billing_private.employees_dispatch(text,jsonb)'::regprocedure);
BEGIN
 IF strpos(definition,'IF length(v_registration) NOT BETWEEN 1 AND 60 THEN')=0 THEN
  RAISE EXCEPTION 'Review the employee registration validation before changing it.';
 END IF;
 definition=replace(definition,'IF length(v_registration) NOT BETWEEN 1 AND 60 THEN','IF length(v_registration)>60 THEN');
 definition=replace(definition,'Informe a matrícula com até 60 caracteres.','A matrícula deve ter até 60 caracteres.');
 EXECUTE definition;
END $migration$;
COMMENT ON COLUMN public.billing_employees.registration_number IS
 'Official textual registration; empty while awaiting assignment. Nonempty registrations remain unique per workspace.';
