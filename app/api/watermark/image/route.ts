// Images now use authenticated uploads and signed URLs from Supabase Storage.
// The former D1/R2 route must not provide a second, unauthenticated write path.
export const dynamic='force-dynamic';
const retired=()=>Response.json({error:'Atualize a página para usar o armazenamento de imagens atual.'},{status:410,headers:{'Cache-Control':'no-store'}});
export const GET=retired;
export const POST=retired;
export const DELETE=retired;
