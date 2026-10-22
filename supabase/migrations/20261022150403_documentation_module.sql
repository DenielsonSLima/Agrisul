BEGIN;

-- Document administration is separate from purchase/service approval.
DO $$
DECLARE v_name text;v_sql text;
BEGIN
 FOR v_name IN SELECT conname FROM pg_constraint WHERE conrelid='public.billing_access_profiles'::regclass
  AND contype='c' AND pg_get_constraintdef(oid) LIKE '%permissions%'
 LOOP EXECUTE format('ALTER TABLE public.billing_access_profiles DROP CONSTRAINT %I',v_name); END LOOP;
 ALTER TABLE public.billing_access_profiles ADD CONSTRAINT billing_access_profiles_permission_catalog CHECK(
  cardinality(permissions)<=19 AND permissions <@ ARRAY[
   'companies.read','companies.write','registrations.read','registrations.write','contracts.read','contracts.write','settings.write',
   'watermarks.read','watermarks.write','users.manage','access-profiles.manage','report-headers.read','report-headers.write',
   'requests.read','requests.write','requests.approve','signatures.manage','documentation.read','documentation.write']::text[]);
 SELECT pg_get_functiondef('billing_private.access_profiles_dispatch(text,jsonb)'::regprocedure) INTO v_sql;
 IF strpos(v_sql,'cardinality(v_permissions)>17')=0 THEN RAISE EXCEPTION 'Unexpected permission catalog'; END IF;
 v_sql=replace(v_sql,'cardinality(v_permissions)>17','cardinality(v_permissions)>19');
 v_sql=replace(v_sql,'''signatures.manage'']::text[]','''signatures.manage'',''documentation.read'',''documentation.write'']::text[]');
 v_sql=replace(v_sql,'IF ((','IF (''documentation.write''=ANY(v_permissions) AND NOT (''documentation.read''=ANY(v_permissions))) OR ((');
 EXECUTE v_sql;
 SELECT pg_get_functiondef('billing_private.create_workspace_defaults(uuid)'::regprocedure) INTO v_sql;
 v_sql=replace(v_sql,'''signatures.manage''','''signatures.manage'',''documentation.read'',''documentation.write''');
 v_sql=replace(v_sql,'''report-headers.read'',''requests.read''','''report-headers.read'',''requests.read'',''documentation.read''');
 EXECUTE v_sql;
END $$;
UPDATE public.billing_access_profiles SET permissions=permissions||ARRAY['documentation.read','documentation.write']::text[] WHERE is_system AND name='Administrador';
UPDATE public.billing_access_profiles SET permissions=permissions||ARRAY['documentation.read']::text[] WHERE is_system AND name='Somente leitura';

CREATE TABLE public.billing_documents (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('invoice','budget','boleto','payment','delivery','photo','other')),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 2 AND 200),
 document_number text NOT NULL DEFAULT '' CHECK(length(document_number)<=100),
 issued_on date, due_on date, amount numeric(18,2) CHECK(amount>=0),
 provider_id uuid,company_id uuid,parent_id uuid,replacement_id uuid,
 status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','verified','divergent','cancelled','replaced')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=2000),
 revision integer NOT NULL DEFAULT 1,created_by uuid NOT NULL,updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,provider_id) REFERENCES public.billing_service_providers(owner_id,id),
 FOREIGN KEY(owner_id,company_id) REFERENCES public.billing_companies(owner_id,id),
 FOREIGN KEY(owner_id,parent_id) REFERENCES public.billing_documents(owner_id,id),
 FOREIGN KEY(owner_id,replacement_id) REFERENCES public.billing_documents(owner_id,id),
 CHECK(parent_id IS DISTINCT FROM id),CHECK(replacement_id IS DISTINCT FROM id),
 CHECK((status='replaced')=(replacement_id IS NOT NULL))
);
CREATE INDEX billing_documents_search_scope ON public.billing_documents(owner_id,created_at DESC,id);
CREATE INDEX billing_documents_provider ON public.billing_documents(owner_id,provider_id);
CREATE INDEX billing_documents_parent ON public.billing_documents(owner_id,parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE public.billing_document_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL,document_id uuid NOT NULL,
 service_request_id uuid,quotation_id uuid,purchase_order_id uuid,
 FOREIGN KEY(owner_id,document_id) REFERENCES public.billing_documents(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,service_request_id) REFERENCES public.billing_service_requests(owner_id,id),
 FOREIGN KEY(owner_id,quotation_id) REFERENCES public.billing_quotations(owner_id,id),
 FOREIGN KEY(owner_id,purchase_order_id) REFERENCES public.billing_purchase_orders(owner_id,id),
 CHECK(num_nonnulls(service_request_id,quotation_id,purchase_order_id)=1),
 UNIQUE NULLS NOT DISTINCT(owner_id,document_id,service_request_id,quotation_id,purchase_order_id)
);
CREATE INDEX billing_document_links_request ON public.billing_document_links(owner_id,service_request_id) WHERE service_request_id IS NOT NULL;
CREATE INDEX billing_document_links_quote ON public.billing_document_links(owner_id,quotation_id) WHERE quotation_id IS NOT NULL;
CREATE INDEX billing_document_links_order ON public.billing_document_links(owner_id,purchase_order_id) WHERE purchase_order_id IS NOT NULL;

CREATE TABLE public.billing_document_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 document_id uuid NOT NULL,actor_id uuid NOT NULL,path text NOT NULL UNIQUE,
 file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 200),
 content_type text NOT NULL CHECK(content_type IN ('application/pdf','image/jpeg','image/png','image/webp','application/xml','text/xml')),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 created_at timestamptz NOT NULL DEFAULT now(),consumed_at timestamptz,
 UNIQUE(owner_id,id)
);
CREATE INDEX billing_document_files_document ON public.billing_document_files(owner_id,document_id);
CREATE TABLE public.billing_document_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL,document_id uuid NOT NULL,
 action text NOT NULL,actor_id uuid NOT NULL,actor_name text NOT NULL,at timestamptz NOT NULL DEFAULT now(),details jsonb NOT NULL,
 FOREIGN KEY(owner_id,document_id) REFERENCES public.billing_documents(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX billing_document_events_document ON public.billing_document_events(owner_id,document_id,at);
CREATE TABLE public.billing_document_expectations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 service_request_id uuid,quotation_id uuid,purchase_order_id uuid,
 kind text NOT NULL CHECK(kind IN ('invoice','budget','boleto','payment','delivery','photo','other')),
 required boolean NOT NULL DEFAULT true,due_on date,notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 updated_by uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_id,service_request_id) REFERENCES public.billing_service_requests(owner_id,id),
 FOREIGN KEY(owner_id,quotation_id) REFERENCES public.billing_quotations(owner_id,id),
 FOREIGN KEY(owner_id,purchase_order_id) REFERENCES public.billing_purchase_orders(owner_id,id),
 CHECK(num_nonnulls(service_request_id,quotation_id,purchase_order_id)=1),
 UNIQUE NULLS NOT DISTINCT(owner_id,service_request_id,quotation_id,purchase_order_id,kind)
);

CREATE FUNCTION billing_private.documentation_source(p_type text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_result jsonb;
BEGIN
 PERFORM billing_private.authorize('documentation.read');
 IF p_type='service' THEN
  SELECT jsonb_build_object('type','service','id',r.id,'label','Serviço nº '||r.number,'description',concat_ws(' · ',r.company_name,
   (SELECT left(string_agg(concat_ws(' ',i->>'description',i->>'application'),', '),300) FROM jsonb_array_elements(r.items) i)),
   'providerId',r.provider_id,'href','/solicitacoes?secao=servico&solicitacao='||r.id::text) INTO v_result
  FROM public.billing_service_requests r WHERE owner_id=v_owner AND id=p_id;
 ELSIF p_type='quotation' THEN
  SELECT jsonb_build_object('type','quotation','id',q.id,'label','Cotação '||q.number,'description',q.title,
   'providerId',null,'href','/cotacao?cotacao='||q.id::text) INTO v_result FROM public.billing_quotations q WHERE owner_id=v_owner AND id=p_id;
 ELSIF p_type='order' THEN
  SELECT jsonb_build_object('type','order','id',p.id,'label','Pedido '||p.number,'description',concat_ws(' · ',p.provider_snapshot->>'legalName',nullif(p.purchase_order_number,'')),
   'providerId',p.provider_id,'quotationId',p.quotation_id,'href','/pedidos?pedido='||p.id::text) INTO v_result
  FROM public.billing_purchase_orders p WHERE owner_id=v_owner AND id=p_id;
 ELSE RAISE EXCEPTION 'Tipo de referência inválido.' USING ERRCODE='22023'; END IF;
 IF v_result IS NULL THEN RAISE EXCEPTION 'Referência não encontrada neste espaço.' USING ERRCODE='P0002'; END IF;
 RETURN v_result;
END $$;

CREATE FUNCTION billing_private.documentation_json(p public.billing_documents) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p.id,'kind',p.kind,'title',p.title,'documentNumber',p.document_number,
  'issuedOn',p.issued_on,'dueOn',p.due_on,'amount',p.amount::text,'providerId',p.provider_id,'companyId',p.company_id,
  'providerName',(SELECT legal_name FROM public.billing_service_providers WHERE owner_id=p.owner_id AND id=p.provider_id),
  'providerDocument',(SELECT document FROM public.billing_service_providers WHERE owner_id=p.owner_id AND id=p.provider_id),
  'companyName',(SELECT legal_name FROM public.billing_companies WHERE owner_id=p.owner_id AND id=p.company_id),
  'parentId',p.parent_id,'parentTitle',(SELECT title FROM public.billing_documents WHERE owner_id=p.owner_id AND id=p.parent_id),
  'replacementId',p.replacement_id,'status',p.status,'notes',p.notes,'reviewNote',p.review_note,'revision',p.revision,
  'createdAt',p.created_at,'updatedAt',p.updated_at,
  'sources',coalesce((SELECT jsonb_agg(billing_private.documentation_source(
    CASE WHEN service_request_id IS NOT NULL THEN 'service' WHEN quotation_id IS NOT NULL THEN 'quotation' ELSE 'order' END,
    coalesce(service_request_id,quotation_id,purchase_order_id)) ORDER BY l.id)
   FROM public.billing_document_links l WHERE l.owner_id=p.owner_id AND l.document_id=p.id),'[]'),
  'files',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'bucket','billing-documentation','path',f.path,
    'fileName',f.file_name,'contentType',f.content_type,'size',f.size_bytes) ORDER BY f.created_at,f.id)
   FROM public.billing_document_files f WHERE f.owner_id=p.owner_id AND f.document_id=p.id AND f.consumed_at IS NOT NULL),'[]'))
$$;

CREATE FUNCTION billing_private.documentation_storage(p_path text,p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND billing_private.has_permission(CASE WHEN p_write THEN 'documentation.write' ELSE 'documentation.read' END)
 AND EXISTS(SELECT 1 FROM public.billing_document_files f WHERE f.owner_id=billing_private.current_owner_id() AND f.path=p_path AND
  CASE WHEN p_write THEN f.actor_id=auth.uid() AND f.consumed_at IS NULL AND f.created_at>now()-interval '24 hours'
  ELSE f.consumed_at IS NOT NULL OR f.actor_id=auth.uid() END)
$$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('billing-documentation','billing-documentation',false,10485760,ARRAY['application/pdf','image/jpeg','image/png','image/webp','application/xml','text/xml']);
CREATE POLICY billing_documentation_storage_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='billing-documentation' AND billing_private.documentation_storage(name,false));
CREATE POLICY billing_documentation_storage_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='billing-documentation' AND billing_private.documentation_storage(name,true));

CREATE FUNCTION billing_private.documentation_pending() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH expected AS (
  SELECT e.*,billing_private.documentation_source(CASE WHEN e.service_request_id IS NOT NULL THEN 'service'
   WHEN e.quotation_id IS NOT NULL THEN 'quotation' ELSE 'order' END,coalesce(e.service_request_id,e.quotation_id,e.purchase_order_id)) source,
   (SELECT d.status FROM public.billing_documents d JOIN public.billing_document_links l ON l.owner_id=d.owner_id AND l.document_id=d.id
    WHERE d.owner_id=e.owner_id AND d.kind=e.kind AND d.status NOT IN ('cancelled','replaced') AND
     (l.service_request_id=e.service_request_id OR l.quotation_id=e.quotation_id OR l.purchase_order_id=e.purchase_order_id)
    ORDER BY CASE d.status WHEN 'verified' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,d.created_at DESC LIMIT 1) document_status
  FROM public.billing_document_expectations e WHERE e.owner_id=billing_private.current_owner_id() AND e.required
 ), pending AS (
  SELECT jsonb_build_object('id',id,'kind',kind,'reason',CASE document_status WHEN 'review' THEN 'review' WHEN 'divergent' THEN 'divergent' ELSE 'missing' END,
   'source',source,'documentId',null,'title',source->>'label','notes',notes,'dueOn',due_on,
   'overdue',due_on<(now() AT TIME ZONE 'America/Sao_Paulo')::date) value FROM expected WHERE document_status IS DISTINCT FROM 'verified'
  UNION ALL
  SELECT jsonb_build_object('id',d.id,'kind',d.kind,'reason',CASE WHEN d.status='divergent' THEN 'divergent'
    WHEN NOT EXISTS(SELECT 1 FROM public.billing_document_links l WHERE l.owner_id=d.owner_id AND l.document_id=d.id) THEN 'unlinked' ELSE 'review' END,
   'source',null,'documentId',d.id,'title',d.title,'notes',d.review_note,'dueOn',null,'overdue',false)
   FROM public.billing_documents d WHERE d.owner_id=billing_private.current_owner_id() AND d.status NOT IN ('cancelled','replaced')
  AND (d.status IN ('review','divergent') OR NOT EXISTS(SELECT 1 FROM public.billing_document_links l WHERE l.owner_id=d.owner_id AND l.document_id=d.id))
  AND NOT EXISTS(SELECT 1 FROM public.billing_document_expectations e JOIN public.billing_document_links l ON l.owner_id=e.owner_id AND
    (l.service_request_id=e.service_request_id OR l.quotation_id=e.quotation_id OR l.purchase_order_id=e.purchase_order_id)
   WHERE e.owner_id=d.owner_id AND l.document_id=d.id AND e.kind=d.kind AND e.required)
 ) SELECT coalesce(jsonb_agg(value ORDER BY (value->>'overdue')::boolean DESC,value->>'dueOn',value->>'title'),'[]') FROM pending
$$;

CREATE FUNCTION billing_private.documentation_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_doc public.billing_documents;v_file public.billing_document_files;
 v_id uuid;v_provider uuid;v_company uuid;v_parent uuid;v_source jsonb;v_link jsonb;v_sources jsonb;v_rows jsonb;v_pending jsonb;v_result jsonb;
 v_kind text;v_title text;v_number text;v_notes text;v_type text;v_search text;v_status text;v_mime text;v_name text;v_size bigint;
 v_amount numeric;v_issued date;v_due date;v_ids uuid[];v_page integer;v_total integer;v_count integer;v_old jsonb;v_revision integer;v_replacement uuid;v_pending_total integer;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar a documentação.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('documentation.read');
 IF p_action NOT IN ('list','get','options','sources','context','save','prepare-upload','review','expectation') OR p_action IS NULL THEN
  RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 IF p_action IN ('save','prepare-upload','review','expectation') THEN
  PERFORM billing_private.lock_request_actor();PERFORM billing_private.authorize('documentation.write');
 END IF;
 IF p_action='options' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY[]::text[]);
  RETURN jsonb_build_object('canManage',billing_private.has_permission('documentation.write'),
   'providers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',legal_name,'document',document) ORDER BY legal_name) FROM public.billing_service_providers WHERE owner_id=v_owner),'[]'),
   'companies',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',legal_name) ORDER BY legal_name) FROM public.billing_companies WHERE owner_id=v_owner),'[]'));
 END IF;
 IF p_action='sources' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['search','type']);
  v_search=btrim(coalesce(p_payload->>'search',''));v_type=coalesce(p_payload->>'type','');
  IF length(v_search)>200 OR v_type NOT IN ('','service','quotation','order') THEN RAISE EXCEPTION 'Confira os filtros.' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(item),'[]') INTO v_rows FROM (
   SELECT billing_private.documentation_source(t,id) item FROM (
    SELECT 'service' t,id,created_at FROM public.billing_service_requests WHERE owner_id=v_owner
    UNION ALL SELECT 'quotation',id,created_at FROM public.billing_quotations WHERE owner_id=v_owner
    UNION ALL SELECT 'order',id,created_at FROM public.billing_purchase_orders WHERE owner_id=v_owner
   ) src WHERE (v_type='' OR t=v_type) AND (v_search='' OR billing_private.documentation_source(t,id)::text ILIKE '%'||v_search||'%')
   ORDER BY created_at DESC,id LIMIT 40
  ) found;
  RETURN jsonb_build_object('sources',v_rows);
 END IF;
 IF p_action='context' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['type','id']);
  v_source=billing_private.documentation_source(p_payload->>'type',(p_payload->>'id')::uuid);
  v_type=v_source->>'type';v_id=(v_source->>'id')::uuid;
  SELECT coalesce(jsonb_agg(billing_private.documentation_json(d) ORDER BY d.created_at DESC),'[]') INTO v_rows
   FROM public.billing_documents d WHERE d.owner_id=v_owner AND EXISTS(
    SELECT 1 FROM public.billing_document_links l WHERE l.owner_id=d.owner_id AND l.document_id=d.id AND
    (v_type='service' AND l.service_request_id=v_id OR v_type='quotation' AND (l.quotation_id=v_id OR l.purchase_order_id IN
     (SELECT id FROM public.billing_purchase_orders WHERE owner_id=v_owner AND quotation_id=v_id))
     OR v_type='order' AND (l.purchase_order_id=v_id OR l.quotation_id=(v_source->>'quotationId')::uuid)));
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'required',e.required,'dueOn',e.due_on,'notes',e.notes)),'[]') INTO v_result
   FROM public.billing_document_expectations e WHERE owner_id=v_owner AND
    (v_type='service' AND service_request_id=v_id OR v_type='quotation' AND quotation_id=v_id OR v_type='order' AND purchase_order_id=v_id);
  v_sources='[]';
  IF v_type='service' AND billing_private.has_permission('requests.read') THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'bucket',f.bucket,'path',f.path,'fileName',f.file_name,'contentType',f.content_type,'size',f.size_bytes)),'[]') INTO v_sources
    FROM public.billing_request_files f WHERE f.owner_id=v_owner AND f.request_id=v_id AND f.kind='budget' AND f.consumed_at IS NOT NULL;
  ELSIF v_type IN ('quotation','order') AND billing_private.has_permission('registrations.read') THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'bucket','billing-quotation-files','path',q.attachment_key,'fileName',q.attachment_name,
     'contentType','application/pdf','size',q.attachment_size)),'[]') INTO v_sources FROM public.billing_quotations q
    WHERE q.owner_id=v_owner AND q.id=CASE WHEN v_type='quotation' THEN v_id ELSE (v_source->>'quotationId')::uuid END AND q.attachment_key IS NOT NULL;
  END IF;
  RETURN jsonb_build_object('source',v_source,'documents',v_rows,'expectations',v_result,'existingFiles',v_sources,
   'canManage',billing_private.has_permission('documentation.write'));
 END IF;
 IF p_action='list' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['search','kind','status','providerId','dateFrom','dateTo','page','includePending']);
  v_search=btrim(coalesce(p_payload->>'search',''));v_kind=coalesce(p_payload->>'kind','');v_status=coalesce(p_payload->>'status','');
  v_provider=nullif(p_payload->>'providerId','')::uuid;v_issued=nullif(p_payload->>'dateFrom','')::date;v_due=nullif(p_payload->>'dateTo','')::date;
  v_page=coalesce((p_payload->>'page')::integer,1);
  IF length(v_search)>200 OR v_page<1 OR v_page>100000 OR v_issued>v_due THEN RAISE EXCEPTION 'Confira os filtros.' USING ERRCODE='22023'; END IF;
  WITH filtered AS (
   SELECT d.* FROM public.billing_documents d LEFT JOIN public.billing_service_providers p ON p.owner_id=d.owner_id AND p.id=d.provider_id
   WHERE d.owner_id=v_owner AND (v_kind='' OR d.kind=v_kind) AND (v_status='' OR d.status=v_status)
    AND (v_provider IS NULL OR d.provider_id=v_provider)
    AND (v_issued IS NULL OR coalesce(d.issued_on,(d.created_at AT TIME ZONE 'America/Sao_Paulo')::date)>=v_issued)
    AND (v_due IS NULL OR coalesce(d.issued_on,(d.created_at AT TIME ZONE 'America/Sao_Paulo')::date)<=v_due)
    AND (v_search='' OR concat_ws(' ',d.title,d.document_number,d.notes,p.legal_name,p.trade_name,p.document) ILIKE '%'||v_search||'%'
     OR p.document ILIKE '%'||regexp_replace(v_search,'[./[:space:]-]','','g')||'%'
     OR EXISTS(SELECT 1 FROM public.billing_document_files f WHERE f.owner_id=d.owner_id AND f.document_id=d.id AND f.file_name ILIKE '%'||v_search||'%')
     OR EXISTS(SELECT 1 FROM public.billing_document_links l WHERE l.owner_id=d.owner_id AND l.document_id=d.id AND
      billing_private.documentation_source(CASE WHEN l.service_request_id IS NOT NULL THEN 'service' WHEN l.quotation_id IS NOT NULL THEN 'quotation' ELSE 'order' END,
       coalesce(l.service_request_id,l.quotation_id,l.purchase_order_id))::text ILIKE '%'||v_search||'%'))
  ) SELECT count(*),coalesce((SELECT jsonb_agg(billing_private.documentation_json(s) ORDER BY s.created_at DESC,s.id) FROM
   (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 30 OFFSET (v_page-1)*30) s),'[]') INTO v_total,v_rows FROM filtered;
  v_pending=CASE WHEN coalesce((p_payload->>'includePending')::boolean,true) THEN billing_private.documentation_pending() ELSE '[]'::jsonb END;
  SELECT coalesce(jsonb_agg(item),'[]') INTO v_pending FROM jsonb_array_elements(v_pending) item
   WHERE (v_kind='' OR item->>'kind'=v_kind) AND (v_status='' OR item->>'reason'=v_status)
    AND (v_provider IS NULL OR item->'source'->>'providerId'=v_provider::text OR EXISTS(SELECT 1 FROM public.billing_documents d WHERE d.owner_id=v_owner AND d.id=(item->>'documentId')::uuid AND d.provider_id=v_provider))
    AND (v_search='' OR item::text ILIKE '%'||v_search||'%' OR EXISTS(SELECT 1 FROM public.billing_documents d LEFT JOIN public.billing_service_providers p ON p.owner_id=d.owner_id AND p.id=d.provider_id
     WHERE d.owner_id=v_owner AND d.id=(item->>'documentId')::uuid AND concat_ws(' ',d.document_number,d.notes,p.legal_name,p.document) ILIKE '%'||v_search||'%'))
    AND (v_issued IS NULL OR coalesce((item->>'dueOn')::date,(SELECT coalesce(d.issued_on,(d.created_at AT TIME ZONE 'America/Sao_Paulo')::date) FROM public.billing_documents d WHERE d.owner_id=v_owner AND d.id=(item->>'documentId')::uuid))>=v_issued)
    AND (v_due IS NULL OR coalesce((item->>'dueOn')::date,(SELECT coalesce(d.issued_on,(d.created_at AT TIME ZONE 'America/Sao_Paulo')::date) FROM public.billing_documents d WHERE d.owner_id=v_owner AND d.id=(item->>'documentId')::uuid))<=v_due);
  v_pending_total=jsonb_array_length(v_pending);
  SELECT coalesce(jsonb_agg(item),'[]') INTO v_pending FROM (SELECT value item FROM jsonb_array_elements(v_pending) WITH ORDINALITY p(value,position) ORDER BY position LIMIT 30 OFFSET (v_page-1)*30) page;
  RETURN jsonb_build_object('documents',v_rows,'total',v_total,'page',v_page,'pageSize',30,'pending',v_pending,'pendingTotal',v_pending_total,
   'canManage',billing_private.has_permission('documentation.write'));
 END IF;
 IF p_action='prepare-upload' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['documentId','fileName','contentType','size']);
  v_id=(p_payload->>'documentId')::uuid;v_name=btrim(p_payload->>'fileName');v_mime=p_payload->>'contentType';v_size=(p_payload->>'size')::bigint;
  IF v_id IS NULL OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 200 OR v_size IS NULL OR v_size NOT BETWEEN 1 AND 10485760
   OR v_mime IS NULL OR v_mime NOT IN ('application/pdf','image/jpeg','image/png','image/webp','application/xml','text/xml') THEN
   RAISE EXCEPTION 'Envie PDF, imagem ou XML de até 10 MB.' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-document:'||v_owner::text||':'||v_id::text,0));
  IF EXISTS(SELECT 1 FROM public.billing_documents WHERE owner_id=v_owner AND id=v_id AND status IN ('cancelled','replaced')) THEN
   RAISE EXCEPTION 'Não é possível anexar a um documento cancelado ou substituído.' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.billing_documents WHERE id=v_id AND owner_id<>v_owner) THEN RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE='P0002'; END IF;
  SELECT count(*) INTO v_count FROM public.billing_document_files WHERE owner_id=v_owner AND document_id=v_id AND (consumed_at IS NOT NULL OR created_at>now()-interval '24 hours');
  IF v_count>=30 THEN RAISE EXCEPTION 'Limite de 30 arquivos por documento.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.billing_document_files(owner_id,document_id,actor_id,path,file_name,content_type,size_bytes)
   VALUES(v_owner,v_id,v_actor,v_owner::text||'/'||v_id::text||'/'||gen_random_uuid()::text||CASE v_mime
    WHEN 'application/pdf' THEN '.pdf' WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' WHEN 'image/webp' THEN '.webp' ELSE '.xml' END,v_name,v_mime,v_size)
   RETURNING * INTO v_file;
  RETURN jsonb_build_object('file',jsonb_build_object('id',v_file.id,'bucket','billing-documentation','path',v_file.path,'fileName',v_file.file_name,'contentType',v_file.content_type,'size',v_file.size_bytes));
 END IF;
 IF p_action='expectation' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['source','kind','required','dueOn','notes']);
  v_source=billing_private.documentation_source(p_payload->'source'->>'type',(p_payload->'source'->>'id')::uuid);
  v_kind=p_payload->>'kind';v_due=nullif(p_payload->>'dueOn','')::date;v_notes=btrim(coalesce(p_payload->>'notes',''));
  IF jsonb_typeof(p_payload->'required') IS DISTINCT FROM 'boolean' OR v_kind IS NULL OR v_kind NOT IN ('invoice','budget','boleto','payment','delivery','photo','other') OR length(v_notes)>2000 THEN
   RAISE EXCEPTION 'Confira o documento esperado.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.billing_document_expectations(owner_id,service_request_id,quotation_id,purchase_order_id,kind,required,due_on,notes,updated_by)
   VALUES(v_owner,CASE WHEN v_source->>'type'='service' THEN (v_source->>'id')::uuid END,
    CASE WHEN v_source->>'type'='quotation' THEN (v_source->>'id')::uuid END,CASE WHEN v_source->>'type'='order' THEN (v_source->>'id')::uuid END,
    v_kind,(p_payload->>'required')::boolean,v_due,v_notes,v_actor)
   ON CONFLICT(owner_id,service_request_id,quotation_id,purchase_order_id,kind) DO UPDATE SET
    required=excluded.required,due_on=excluded.due_on,notes=excluded.notes,updated_by=v_actor,updated_at=now();
  RETURN jsonb_build_object('saved',true);
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o documento.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_doc FROM public.billing_documents WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF p_action='get' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['id']);
  IF v_doc.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('document',billing_private.documentation_json(v_doc),'canManage',billing_private.has_permission('documentation.write'),
   'children',coalesce((SELECT jsonb_agg(billing_private.documentation_json(d) ORDER BY d.due_on,d.created_at) FROM public.billing_documents d WHERE d.owner_id=v_owner AND d.parent_id=v_id),'[]'),
   'history',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'action',action,'actorName',actor_name,'at',at,'details',details) ORDER BY at,id)
    FROM public.billing_document_events WHERE owner_id=v_owner AND document_id=v_id),'[]'));
 END IF;
 v_revision=coalesce((p_payload->>'expectedRevision')::integer,0);
 IF v_doc.id IS NOT NULL AND v_doc.revision<>v_revision THEN
  IF v_doc.revision=v_revision+1 AND EXISTS(SELECT 1 FROM public.billing_document_events e WHERE e.owner_id=v_owner AND e.document_id=v_id
   AND e.actor_id=v_actor AND e.details->'input'=p_payload AND (e.details->'document'->>'revision')::integer=v_doc.revision) THEN
   RETURN jsonb_build_object('document',billing_private.documentation_json(v_doc));
  END IF;
  RAISE EXCEPTION 'O documento foi atualizado. Reabra e confira os dados.' USING ERRCODE='23505';
 END IF;
 IF p_action='review' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['id','expectedRevision','status','note','replacementId']);
  IF v_doc.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE='P0002'; END IF;
  v_status=p_payload->>'status';v_notes=btrim(coalesce(p_payload->>'note',''));v_replacement=nullif(p_payload->>'replacementId','')::uuid;
  IF v_status IS NULL OR v_status NOT IN ('review','verified','divergent','cancelled','replaced') OR length(v_notes)>2000
   OR (v_status IN ('divergent','cancelled','replaced') AND length(v_notes)<3) THEN RAISE EXCEPTION 'Informe a situação e o motivo da alteração.' USING ERRCODE='22023'; END IF;
  IF v_doc.status IN ('cancelled','replaced') THEN RAISE EXCEPTION 'Este documento já foi cancelado ou substituído.' USING ERRCODE='23514'; END IF;
  IF v_status='replaced' AND (v_replacement IS NULL OR v_replacement=v_id OR NOT EXISTS(SELECT 1 FROM public.billing_documents d
   WHERE d.owner_id=v_owner AND d.id=v_replacement AND d.kind=v_doc.kind AND d.provider_id IS NOT DISTINCT FROM v_doc.provider_id
    AND d.company_id IS NOT DISTINCT FROM v_doc.company_id AND d.status NOT IN ('cancelled','replaced'))) THEN
   RAISE EXCEPTION 'Selecione a substituição do mesmo tipo, fornecedor e empresa.' USING ERRCODE='22023'; END IF;
  IF v_status<>'replaced' AND v_replacement IS NOT NULL THEN RAISE EXCEPTION 'Substituição incompatível com a situação.' USING ERRCODE='22023'; END IF;
  UPDATE public.billing_documents SET status=v_status,review_note=v_notes,replacement_id=v_replacement,revision=revision+1,updated_at=now(),updated_by=v_actor
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_doc;
 ELSE
  PERFORM billing_private.request_payload(p_payload,ARRAY['id','expectedRevision','kind','title','documentNumber','issuedOn','dueOn','amount','providerId','companyId','parentId','notes','sources','fileIds']);
  IF v_doc.status IN ('cancelled','replaced') THEN RAISE EXCEPTION 'Este documento já foi cancelado ou substituído.' USING ERRCODE='23514'; END IF;
  v_kind=p_payload->>'kind';v_title=btrim(p_payload->>'title');v_number=btrim(coalesce(p_payload->>'documentNumber',''));v_notes=btrim(coalesce(p_payload->>'notes',''));
  v_issued=nullif(p_payload->>'issuedOn','')::date;v_due=nullif(p_payload->>'dueOn','')::date;
  IF nullif(p_payload->>'amount','') IS NOT NULL AND p_payload->>'amount' !~ '^[0-9]{1,16}([.][0-9]{1,2})?$' THEN
   RAISE EXCEPTION 'Informe um valor com até duas casas decimais.' USING ERRCODE='22023'; END IF;
  v_amount=nullif(p_payload->>'amount','')::numeric;
  v_provider=nullif(p_payload->>'providerId','')::uuid;v_company=nullif(p_payload->>'companyId','')::uuid;v_parent=nullif(p_payload->>'parentId','')::uuid;
  IF v_kind IS NULL OR v_kind NOT IN ('invoice','budget','boleto','payment','delivery','photo','other') OR v_title IS NULL OR length(v_title) NOT BETWEEN 2 AND 200
   OR length(v_number)>100 OR length(v_notes)>4000 OR jsonb_typeof(p_payload->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'sources')>20
   OR jsonb_typeof(p_payload->'fileIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'fileIds')>30 THEN
   RAISE EXCEPTION 'Confira título, tipo, referências e arquivos.' USING ERRCODE='22023'; END IF;
  -- Resolve supplier from references on the server; payload ownership is never accepted.
  FOR v_link IN SELECT value FROM jsonb_array_elements(p_payload->'sources') LOOP
   PERFORM billing_private.request_payload(v_link,ARRAY['type','id']);
   v_source=billing_private.documentation_source(v_link->>'type',(v_link->>'id')::uuid);
   IF nullif(v_source->>'providerId','') IS NOT NULL THEN
    IF v_provider IS NOT NULL AND v_provider<>(v_source->>'providerId')::uuid THEN RAISE EXCEPTION 'As referências devem pertencer ao mesmo fornecedor.' USING ERRCODE='23514'; END IF;
    v_provider=(v_source->>'providerId')::uuid;
   END IF;
  END LOOP;
  IF v_provider IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_service_providers WHERE owner_id=v_owner AND id=v_provider) OR
   v_company IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company) THEN
   RAISE EXCEPTION 'Selecione fornecedor e empresa deste espaço.' USING ERRCODE='23514'; END IF;
  IF v_doc.id IS NOT NULL AND (v_provider IS DISTINCT FROM v_doc.provider_id OR v_company IS DISTINCT FROM v_doc.company_id)
   AND EXISTS(SELECT 1 FROM public.billing_documents d WHERE d.owner_id=v_owner AND (d.parent_id=v_id OR d.replacement_id=v_id
    OR d.id=v_doc.replacement_id)) THEN
   RAISE EXCEPTION 'Preserve o fornecedor e a empresa dos documentos relacionados.' USING ERRCODE='23514'; END IF;
  IF v_parent IS NOT NULL THEN
   IF v_parent=v_id OR EXISTS(SELECT 1 FROM public.billing_documents WHERE owner_id=v_owner AND parent_id=v_id) OR NOT EXISTS(
    SELECT 1 FROM public.billing_documents d WHERE d.owner_id=v_owner AND d.id=v_parent AND d.parent_id IS NULL AND d.status NOT IN ('cancelled','replaced')
     AND d.provider_id IS NOT DISTINCT FROM v_provider AND d.company_id IS NOT DISTINCT FROM v_company) THEN
    RAISE EXCEPTION 'O documento principal deve ser do mesmo fornecedor e empresa, sem vínculos circulares.' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT coalesce(array_agg(value::uuid),'{}') INTO v_ids FROM jsonb_array_elements_text(p_payload->'fileIds');
  IF cardinality(v_ids)<>(SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN RAISE EXCEPTION 'Arquivos duplicados.' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_count FROM public.billing_document_files f WHERE f.owner_id=v_owner AND f.document_id=v_id AND f.id=ANY(v_ids)
   AND (f.consumed_at IS NOT NULL OR f.actor_id=v_actor AND f.created_at>now()-interval '24 hours')
   AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='billing-documentation' AND o.name=f.path
    AND (to_jsonb(o)->'metadata'->>'size')::bigint=f.size_bytes
    AND to_jsonb(o)->'metadata'->>'mimetype'=f.content_type);
  IF v_count<>cardinality(v_ids) OR v_count=0 AND v_doc.id IS NULL THEN RAISE EXCEPTION 'Envie os arquivos antes de salvar o documento.' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.billing_document_files WHERE owner_id=v_owner AND document_id=v_id AND consumed_at IS NOT NULL AND NOT (id=ANY(v_ids))) THEN
   RAISE EXCEPTION 'Os arquivos anteriores devem ser preservados. Cancele ou substitua o documento se necessário.' USING ERRCODE='23514'; END IF;
  v_old=to_jsonb(v_doc);
  IF v_doc.id IS NULL THEN
   INSERT INTO public.billing_documents(id,owner_id,kind,title,document_number,issued_on,due_on,amount,provider_id,company_id,parent_id,notes,created_by,updated_by)
    VALUES(v_id,v_owner,v_kind,v_title,v_number,v_issued,v_due,v_amount,v_provider,v_company,v_parent,v_notes,v_actor,v_actor) RETURNING * INTO v_doc;
  ELSE
   UPDATE public.billing_documents SET kind=v_kind,title=v_title,document_number=v_number,issued_on=v_issued,due_on=v_due,amount=v_amount,
    provider_id=v_provider,company_id=v_company,parent_id=v_parent,notes=v_notes,status='review',review_note='',revision=revision+1,updated_by=v_actor,updated_at=now()
    WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_doc;
  END IF;
  DELETE FROM public.billing_document_links WHERE owner_id=v_owner AND document_id=v_id;
  FOR v_link IN SELECT value FROM jsonb_array_elements(p_payload->'sources') LOOP
   INSERT INTO public.billing_document_links(owner_id,document_id,service_request_id,quotation_id,purchase_order_id)
    VALUES(v_owner,v_id,CASE WHEN v_link->>'type'='service' THEN (v_link->>'id')::uuid END,
     CASE WHEN v_link->>'type'='quotation' THEN (v_link->>'id')::uuid END,CASE WHEN v_link->>'type'='order' THEN (v_link->>'id')::uuid END);
  END LOOP;
  UPDATE public.billing_document_files SET consumed_at=coalesce(consumed_at,now()) WHERE owner_id=v_owner AND document_id=v_id AND id=ANY(v_ids);
 END IF;
 SELECT coalesce(name,'Usuário') INTO v_name FROM public.billing_user_settings WHERE user_id=v_actor;
 INSERT INTO public.billing_document_events(owner_id,document_id,action,actor_id,actor_name,details)
  VALUES(v_owner,v_id,CASE WHEN p_action='review' THEN v_doc.status WHEN v_revision=0 THEN 'created' ELSE 'updated' END,v_actor,coalesce(v_name,'Usuário'),
   jsonb_build_object('before',v_old,'document',billing_private.documentation_json(v_doc),'input',p_payload));
 RETURN jsonb_build_object('document',billing_private.documentation_json(v_doc));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Confira os identificadores, datas e valores informados.' USING ERRCODE='22023';
END $$;

DO $$
DECLARE t text;f regprocedure;v_sql text;
BEGIN
 FOREACH t IN ARRAY ARRAY['billing_documents','billing_document_links','billing_document_files','billing_document_events','billing_document_expectations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY billing_documentation_read ON public.%I FOR SELECT TO authenticated USING (billing_private.can_access_owner(owner_id,''documentation.read''))',t);
  EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL',t);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t); END IF;
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='billing_private' AND p.proname LIKE 'documentation_%'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f); END LOOP;
 SELECT pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure) INTO v_sql;
 IF strpos(v_sql,'PERFORM billing_private.ensure_actor_workspace();')=0 THEN RAISE EXCEPTION 'Unexpected public RPC'; END IF;
 v_sql=replace(v_sql,'PERFORM billing_private.ensure_actor_workspace();',
  E'PERFORM billing_private.ensure_actor_workspace();\n IF p_resource=''documentation'' THEN RETURN billing_private.documentation_dispatch(p_action,p_payload); END IF;');
 EXECUTE v_sql;
END $$;
GRANT EXECUTE ON FUNCTION billing_private.documentation_dispatch(text,jsonb),billing_private.documentation_storage(text,boolean) TO authenticated;
COMMENT ON TABLE public.billing_documents IS 'Private operational documents. Boleto presence and document verification never imply payment or physical receipt.';
COMMIT;
