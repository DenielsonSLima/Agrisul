import {handleResourceRequest} from "@/shared/supabase/server";
export const dynamic="force-dynamic";
export async function GET(request:Request){return handleResourceRequest(request,"contract-types")}
export async function POST(request:Request){return handleResourceRequest(request,"contract-types")}
export async function PATCH(request:Request){return handleResourceRequest(request,"contract-types")}
export async function DELETE(request:Request){return handleResourceRequest(request,"contract-types")}
