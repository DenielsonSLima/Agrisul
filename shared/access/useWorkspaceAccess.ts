'use client';
import {useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {rpcRequest} from '@/shared/supabase/rpc';
import type {WorkspaceAccessSnapshot} from './routeAccess';
export type WorkspaceCompany={id:string;name:string;isPrimary:boolean};
export type WorkspacePermissions=WorkspaceAccessSnapshot&{companies:WorkspaceCompany[]};
const fetchWorkspaceAccess=(signal:AbortSignal)=>rpcRequest<WorkspacePermissions>('permissions','get',{},signal);
export function useWorkspaceAccess(){return useCadastroQuery('permissions',{},fetchWorkspaceAccess);}
