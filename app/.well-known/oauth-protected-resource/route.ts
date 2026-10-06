import {getMcpConfig, getMcpResourceMetadata} from '@/modules/mcp/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const config = getMcpConfig();
  if (!config) return new Response(null, {status: 404, headers: {'Cache-Control': 'no-store'}});
  const origin = request.headers.get('origin');
  if (origin && origin !== config.resourceOrigin) {
    return Response.json({error: 'forbidden_origin'}, {status: 403, headers: {'Cache-Control': 'no-store'}});
  }
  return Response.json(getMcpResourceMetadata(config), {headers: {'Cache-Control': 'no-store'}});
}
