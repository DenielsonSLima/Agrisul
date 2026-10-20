import {createHash, randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {matchImportItems, searchCatalog, type CatalogMaterial} from './catalog.ts';
import {ingestExternalProductPhoto} from './photoIngest.ts';
import {createMcpQuotationPdf, type McpQuotationPdfInput} from './quotePdf.ts';

export type McpToolContext = {client: SupabaseClient; userId: string};
export type McpToolResult = {
  content: ({type: 'text'; text: string} | {
    type: 'resource_link'; uri: string; name: string; description: string; mimeType: string;
  })[];
  structuredContent?: unknown;
  isError?: boolean;
};

const uuid = z.string().uuid();
const httpsUrl = z.string().url().max(2000).refine(value => value.startsWith('https://'), 'Use HTTPS.');
const itemSchema = z.object({
  materialId: uuid.optional(),
  name: z.string().trim().min(2).max(150),
  internalCode: z.string().trim().max(60).optional(),
  brand: z.string().trim().max(100).optional(),
  code: z.string().trim().max(60).optional(),
  unit: z.string().trim().min(1).max(30),
  quantity: z.string().regex(/^\d{1,12}(?:[.,]\d{1,3})?$/),
  application: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(1000).optional(),
  sourceText: z.string().trim().min(1).max(500),
  imageSourceUrl: httpsUrl.optional(),
  imageEvidenceUrl: httpsUrl.optional(),
}).strict();
const itemsSchema = z.array(itemSchema).min(1).max(100);
const sourceSchema = z.object({
  kind: z.literal('chat-image'),
  label: z.string().trim().min(1).max(200),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
}).strict();
const prepareSchema = z.object({items: itemsSchema}).strict();
const commitSchema = z.object({
  requestId: uuid,
  source: sourceSchema,
  requesterSignatureId: uuid,
  title: z.string().trim().min(2).max(150),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(2000).default(''),
  items: itemsSchema,
  providers: z.array(z.object({providerId: uuid}).strict()).max(50).default([]),
}).strict();

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const string = (description: string) => ({type: 'string', description});
const itemJsonSchema = objectSchema({
  materialId: string('ID do material existente, somente após conferir a correspondência.'),
  name: string('Nome legível na foto; não invente o produto.'),
  internalCode: string('Código interno, somente se estiver identificado.'),
  brand: string('Marca legível do produto.'),
  code: string('Código do fabricante legível do produto.'),
  unit: string('Unidade pedida na lista.'),
  quantity: string('Quantidade positiva, até três casas decimais.'),
  application: string('Aplicação documentada na lista, se houver.'),
  notes: string('Observação da linha.'),
  sourceText: string('Transcrição literal curta da linha da foto que justifica o item.'),
  imageSourceUrl: string('URL HTTPS da foto exata do fabricante ou catálogo confiável.'),
  imageEvidenceUrl: string('Página HTTPS com schema.org JSON-LD Product que vincula marca, código e URL exata da foto.'),
}, ['name', 'unit', 'quantity', 'sourceText']);
const sourceJsonSchema = objectSchema({
  kind: {type: 'string', enum: ['chat-image']},
  label: string('Nome ou referência da foto enviada no chat.'),
  sha256: string('SHA-256 do arquivo de origem, quando disponível.'),
}, ['kind', 'label']);
const oauth = [{type: 'oauth2', scopes: []}];

export function listMcpTools() {
  return [
    {
      name: 'search_materials',
      title: 'Buscar materiais',
      description: 'Use antes de cadastrar qualquer material. Busca no catálogo autorizado por nome, código interno, marca ou código de fabricante. Correspondência semelhante não confirma identidade.',
      inputSchema: objectSchema({query: string('Nome, marca ou código legível na foto.'), limit: {type: 'integer', minimum: 1, maximum: 20}}, ['query']),
      annotations: {readOnlyHint: true, openWorldHint: false}, securitySchemes: oauth,
    },
    {
      name: 'list_requesters',
      title: 'Listar solicitantes',
      description: 'Lista assinaturas ativas com papel de solicitante, necessárias para criar cotação.',
      inputSchema: objectSchema({search: string('Filtro opcional de nome.'), page: {type: 'integer', minimum: 1, maximum: 1000}}, []),
      annotations: {readOnlyHint: true, openWorldHint: false}, securitySchemes: oauth,
    },
    {
      name: 'list_providers',
      title: 'Listar fornecedores',
      description: 'Lista fornecedores existentes para o usuário escolher. A cotação também pode ficar sem fornecedor para preenchimento posterior.',
      inputSchema: objectSchema({query: string('Filtro opcional pelo nome.')}, []),
      annotations: {readOnlyHint: true, openWorldHint: false}, securitySchemes: oauth,
    },
    {
      name: 'prepare_quote_import',
      title: 'Conferir itens da foto',
      description: 'Confronta linhas extraídas da foto com o catálogo, sem gravar nada. Peça esclarecimento apenas para linha ilegível ou identidade ambígua. Foto parecida nunca é foto exata.',
      inputSchema: objectSchema({items: {type: 'array', minItems: 1, maxItems: 100, items: itemJsonSchema}}, ['items']),
      annotations: {readOnlyHint: true, openWorldHint: false}, securitySchemes: oauth,
    },
    {
      name: 'commit_quote_import',
      title: 'Criar cotação da foto',
      description: 'Após conferir a foto e os materiais, cria materiais faltantes com foto exata e cotação numa RPC transacional e idempotente. Para material novo, a página de evidência deve conter schema.org JSON-LD Product vinculando marca, código e URL exata da foto. Não envie cotação a fornecedor. Fornecedores são opcionais.',
      inputSchema: objectSchema({
        requestId: string('UUID estável para repetir esta mesma importação sem duplicar registros.'),
        source: sourceJsonSchema,
        requesterSignatureId: string('ID de solicitante ativo da lista de assinaturas.'),
        title: string('Título da cotação.'),
        requestDate: string('Data YYYY-MM-DD.'),
        notes: string('Observações da cotação.'),
        items: {type: 'array', minItems: 1, maxItems: 100, items: itemJsonSchema},
        providers: {type: 'array', maxItems: 50, items: objectSchema({providerId: string('ID de fornecedor existente.')}, ['providerId'])},
      }, ['requestId', 'source', 'requesterSignatureId', 'title', 'requestDate', 'items']),
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true}, securitySchemes: oauth,
    },
    {
      name: 'get_quote_pdf',
      title: 'Obter PDF da cotação',
      description: 'Entrega link temporário do PDF da cotação, inclusive sem fornecedor. Leitor pode reutilizar uma versão já armazenada; gerar uma versão nova exige permissão de escrita.',
      inputSchema: objectSchema({quoteId: string('ID da cotação existente.')}, ['quoteId']),
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false}, securitySchemes: oauth,
    },
    {
      name: 'unlink_account',
      title: 'Desvincular conta Agrisul',
      description: 'Use somente se o usuário pedir para desvincular a conta. Revoga o grant OAuth no Supabase quando existe token B válido e remove a cópia local; sem ele, informa que somente a ausência local foi verificada.',
      inputSchema: objectSchema({}),
      annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false}, securitySchemes: oauth,
    },
  ];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function catalogMaterial(value: unknown): CatalogMaterial | null {
  const object = asObject(value);
  if (typeof object.id !== 'string' || typeof object.name !== 'string' || typeof object.unit !== 'string') return null;
  const references = Array.isArray(object.references) ? object.references : [];
  return {
    id: object.id, name: object.name, unit: object.unit,
    internalCode: typeof object.internalCode === 'string' ? object.internalCode : '',
    imageKey: typeof object.imageKey === 'string' ? object.imageKey : null,
    references: references.map(reference => asObject(reference)).filter(reference =>
      typeof reference.id === 'string' && typeof reference.brand === 'string' && typeof reference.code === 'string',
    ).map(reference => ({id: reference.id as string, brand: reference.brand as string, code: reference.code as string})),
  };
}

async function billing(client: SupabaseClient, resource: string, action: string, payload: Record<string, unknown>) {
  const {data, error} = await client.rpc('billing_rpc', {p_resource: resource, p_action: action, p_payload: payload});
  if (error) {
    const safe = ['22023', '23505', '23514', 'P0001', 'P0002', '42501', '28000'].includes(error.code);
    throw new Error(safe ? error.message : 'Não foi possível concluir a operação no banco.');
  }
  return asObject(data);
}

async function materials(client: SupabaseClient) {
  const result = await billing(client, 'materials', 'list', {});
  return (Array.isArray(result.materials) ? result.materials : [])
    .map(catalogMaterial).filter((material): material is CatalogMaterial => material !== null);
}

function result(data: unknown, extra: McpToolResult['content'] = []): McpToolResult {
  return {structuredContent: data, content: [{type: 'text', text: JSON.stringify(data)}, ...extra]};
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function originalImportInput(stored: Record<string, unknown>) {
  const items = Array.isArray(stored.items) ? stored.items.map(value => {
    const {imageKey: _imageKey, imageName: _imageName, ...original} = asObject(value);
    void _imageKey;
    void _imageName;
    return original;
  }) : [];
  return {...stored, items};
}

async function importedResult(client: SupabaseClient, imported: Record<string, unknown>): Promise<McpToolResult> {
  const quote = asObject(imported.quote);
  let pdf: {url: string; fileName: string} | null = null;
  let pdfError: string | null = null;
  try {pdf = await quotationPdf(client, quote);} catch {pdfError = 'Cotação criada; tente get_quote_pdf para obter o PDF.';}
  const output = {...imported, committed: true, pdf, pdfError};
  return result(output, pdf ? [{
    type: 'resource_link', uri: pdf.url, name: pdf.fileName,
    description: 'PDF da cotação; link temporário de uma hora.', mimeType: 'application/pdf',
  }] : []);
}

async function workspaceId(client: SupabaseClient) {
  const {settings} = await billing(client, 'settings', 'get', {});
  const id = asObject(settings).workspaceId;
  if (typeof id !== 'string' || !uuid.safeParse(id).success) throw new Error('Não foi possível identificar o espaço autorizado.');
  return id;
}

async function uploadExactPhoto(
  client: SupabaseClient,
  ownerId: string,
  requestId: string,
  index: number,
  item: z.infer<typeof itemSchema>,
) {
  if (!item.imageSourceUrl || !item.imageEvidenceUrl || !item.brand || !item.code) {
    throw new Error(`O item ${index + 1} precisa de foto exata, marca, código e página de comprovação.`);
  }
  const photo = await ingestExternalProductPhoto({
    url: item.imageSourceUrl,
    evidenceUrl: item.imageEvidenceUrl,
    brand: item.brand,
    code: item.code,
  });
  const imageKey = `${ownerId}/materials/mcp-${requestId}-${index + 1}.webp`;
  const storage = client.storage.from('billing-material-images');
  const {error} = await storage.upload(imageKey, photo.bytes, {
    contentType: 'image/webp', upsert: false, cacheControl: '31536000',
  });
  if (error) {
    if (Number(error.statusCode) !== 409) throw new Error('Não foi possível armazenar a foto do material.');
    const existing = await storage.download(imageKey);
    if (existing.error || !existing.data) throw new Error('Não foi possível conferir a foto já enviada.');
    const existingHash = createHash('sha256').update(Buffer.from(await existing.data.arrayBuffer())).digest('hex');
    if (existingHash !== photo.sha256) throw new Error('A chave de importação já foi usada com uma foto diferente.');
  }
  const imageName = `${item.brand} ${item.code}.webp`.replace(/[\\/\u0000-\u001f]/g, ' ').slice(0, 255);
  return {imageKey, imageName};
}

async function quotationPdf(client: SupabaseClient, quote: Record<string, unknown>) {
  const id = quote.id;
  if (typeof id !== 'string' || !uuid.safeParse(id).success) throw new Error('Cotação inválida para gerar PDF.');
  const ownerId = await workspaceId(client);
  const rawItems = Array.isArray(quote.items) ? quote.items : [];
  const imageKeys = rawItems.map(value => asObject(value).materialImageKey)
    .filter((key): key is string => typeof key === 'string' && key.startsWith(`${ownerId}/materials/`));
  const images = new Map<string, McpQuotationPdfInput['items'][number]['image']>();
  for (const key of [...new Set(imageKeys)]) {
    try {
      const downloaded = await client.storage.from('billing-material-images').download(key);
      if (downloaded.error || !downloaded.data || downloaded.data.size > 3 * 1024 * 1024) continue;
      const {default: sharp} = await import('sharp');
      const converted = await sharp(Buffer.from(await downloaded.data.arrayBuffer()), {limitInputPixels: 16_000_000})
        .resize({width: 300, height: 300, fit: 'inside', withoutEnlargement: true})
        .jpeg({quality: 82}).toBuffer({resolveWithObject: true});
      images.set(key, {bytes: converted.data, format: 'JPEG', width: converted.info.width, height: converted.info.height});
    } catch {
      // The quotation remains exportable if a private photo is missing or damaged.
    }
  }
  const pdfInput: McpQuotationPdfInput = {
    title: String(quote.title ?? ''), number: String(quote.number ?? ''),
    requestDate: String(quote.requestDate ?? ''), requester: String(quote.requester ?? ''),
    notes: String(quote.notes ?? ''),
    items: rawItems.map(value => {
      const item = asObject(value);
      const imageKey = typeof item.materialImageKey === 'string' ? item.materialImageKey : '';
      return {
        materialName: String(item.materialName ?? ''),
        materialCode: String(item.materialCode ?? ''),
        quantity: String(item.quantity ?? ''), unit: String(item.unit ?? ''),
        materialReferences: Array.isArray(item.materialReferences)
          ? item.materialReferences.map(reference => asObject(reference)).map(reference => ({
            brand: String(reference.brand ?? ''), code: String(reference.code ?? ''),
          })) : [],
        image: images.get(imageKey),
      };
    }),
  };
  const pdf = await createMcpQuotationPdf(pdfInput);
  if (pdf.byteLength < 100 || pdf.byteLength > 10 * 1024 * 1024) throw new Error('O PDF excede o limite do armazenamento.');
  const fingerprint = createHash('sha256').update(pdf).digest('hex').slice(0, 20);
  const path = `${ownerId}/quotations/mcp/${id}-${fingerprint}.pdf`;
  const storage = client.storage.from('billing-quotation-files');
  const verifyExisting = async () => {
    const existing = await storage.download(path);
    if (existing.error || !existing.data || existing.data.size > 10 * 1024 * 1024) {
      throw new Error('Não foi possível conferir o PDF armazenado.');
    }
    const storedFingerprint = createHash('sha256')
      .update(Buffer.from(await existing.data.arrayBuffer())).digest('hex').slice(0, 20);
    if (storedFingerprint !== fingerprint) throw new Error('O PDF armazenado não corresponde à cotação atual.');
  };
  let found;
  try {found = await storage.exists(path);} catch {throw new Error('Não foi possível conferir o PDF armazenado.');}
  if (found.data === true) {
    await verifyExisting();
  } else if (found.data === false && (!found.error || [400, 404].includes(Number(found.error.statusCode)))) {
    const uploaded = await storage.upload(path, Buffer.from(pdf), {contentType: 'application/pdf', upsert: false});
    if (uploaded.error) {
      if (Number(uploaded.error.statusCode) !== 409) {
        if ([401, 403].includes(Number(uploaded.error.statusCode))) {
          throw new Error('O PDF desta versão ainda não está armazenado; é necessária permissão de escrita para gerá-lo.');
        }
        throw new Error('Não foi possível armazenar o PDF.');
      }
    }
    await verifyExisting();
  } else {
    throw new Error('Não foi possível conferir o PDF armazenado.');
  }
  const signed = await storage.createSignedUrl(path, 3600);
  if (signed.error || !signed.data?.signedUrl) throw new Error('Não foi possível criar o link temporário do PDF.');
  return {url: signed.data.signedUrl, fileName: `cotacao-${String(quote.number ?? id).replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf`};
}

export async function callMcpTool(name: string, args: unknown, context: McpToolContext): Promise<McpToolResult> {
  try {
    if (name === 'search_materials') {
      const input = z.object({query: z.string().trim().min(2).max(100), limit: z.number().int().min(1).max(20).default(20)}).strict().parse(args);
      const found = searchCatalog(await materials(context.client), input.query, input.limit);
      return result({materials: found, count: found.length});
    }
    if (name === 'list_requesters') {
      const input = z.object({search: z.string().trim().max(100).default(''), page: z.number().int().min(1).max(1000).default(1)}).strict().parse(args);
      const requesters: {id: unknown; name: unknown}[] = [];
      for (let sourcePage = 1; sourcePage <= 20; sourcePage += 1) {
        const response = await billing(context.client, 'signatures', 'list', {
          search: input.search, page: sourcePage, pageSize: 100, status: 'active',
        });
        requesters.push(...(Array.isArray(response.items) ? response.items : [])
          .map(asObject).filter(item => item.role === 'requester' && item.active !== false)
          .map(item => ({id: item.id, name: item.name})));
        const total = Number(response.total);
        if (!Number.isSafeInteger(total) || total < 0) throw new Error('Lista de solicitantes inválida.');
        if (total > 2000) throw new Error('Há muitas assinaturas; informe um filtro de nome.');
        if (sourcePage * 100 >= total) break;
      }
      return result({requesters: requesters.slice((input.page - 1) * 100, input.page * 100),
        page: input.page, total: requesters.length});
    }
    if (name === 'list_providers') {
      const input = z.object({query: z.string().trim().max(100).default('')}).strict().parse(args);
      const response = await billing(context.client, 'service-providers', 'list', {});
      const collection = Array.isArray(response.providers) ? response.providers : [];
      const query = input.query.toLocaleLowerCase('pt-BR');
      return result({providers: collection.map(asObject)
        .filter(provider => String(provider.legalName ?? '').toLocaleLowerCase('pt-BR').includes(query))
        .slice(0, 50).map(provider => ({id: provider.id, name: provider.legalName}))});
    }
    if (name === 'prepare_quote_import') {
      const input = prepareSchema.parse(args);
      const catalog = await materials(context.client);
      const matches = matchImportItems(input.items, catalog);
      const candidates = matches.map(match => ({...match, candidates: (match.candidateIds ?? [])
        .map(id => catalog.find(material => material.id === id)).filter(Boolean)
        .map(material => ({id: material!.id, name: material!.name, internalCode: material!.internalCode, unit: material!.unit}))}));
      return result({ready: matches.every(match => ['existing', 'new'].includes(match.status)), requestId: randomUUID(), matches: candidates});
    }
    if (name === 'commit_quote_import') {
      const input = commitSchema.parse(args);
      const previous = await billing(context.client, 'quotations', 'import-status', {requestId: input.requestId});
      if (previous.exists === true) {
        const stored = asObject(previous.requestPayload);
        if (canonicalJson(originalImportInput(stored)) !== canonicalJson(input)) {
          throw new Error('Esta chave de importação já foi usada com outros dados.');
        }
        const replay = await billing(context.client, 'quotations', 'import-draft', stored);
        return importedResult(context.client, replay);
      }
      const catalog = await materials(context.client);
      const matches = matchImportItems(input.items, catalog);
      if (matches.some(match => !['existing', 'new'].includes(match.status))) {
        return result({committed: false, matches});
      }
      const ownerId = await workspaceId(context.client);
      const items = [];
      for (const [index, item] of input.items.entries()) {
        const match = matches[index];
        const uploaded = match.status === 'new'
          ? await uploadExactPhoto(context.client, ownerId, input.requestId, index, item)
          : {};
        items.push({...item, ...uploaded});
      }
      const payload = {...input, items};
      const imported = await billing(context.client, 'quotations', 'import-draft', payload);
      return importedResult(context.client, imported);
    }
    if (name === 'get_quote_pdf') {
      const input = z.object({quoteId: uuid}).strict().parse(args);
      const response = await billing(context.client, 'quotations', 'get', {id: input.quoteId});
      const pdf = await quotationPdf(context.client, asObject(response.quote));
      return result({quoteId: input.quoteId, pdfUrl: pdf.url, expiresInSeconds: 3600}, [{
        type: 'resource_link', uri: pdf.url, name: pdf.fileName,
        description: 'PDF da cotação; link temporário de uma hora.', mimeType: 'application/pdf',
      }]);
    }
    return {content: [{type: 'text', text: 'Ferramenta desconhecida.'}], isError: true};
  } catch (error) {
    const message = error instanceof z.ZodError ? 'Dados incompletos ou inválidos para esta ferramenta.'
      : error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
    return {content: [{type: 'text', text: message}], isError: true};
  }
}
