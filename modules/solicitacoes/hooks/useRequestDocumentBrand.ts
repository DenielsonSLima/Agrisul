'use client';
import {useQuery} from '@tanstack/react-query';
import {billingKeys} from '@/shared/query/keys';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {fetchRequestDocumentBrand} from '../services/documentBrandApi';

export function useRequestDocumentBrand() {
  const {user, ready} = useAuth();
  return useQuery({queryKey: [...billingKeys.resource(user?.id ?? 'anonymous', 'service-requests'), {view: 'document-brand'}], queryFn: ({signal}) => fetchRequestDocumentBrand(signal), enabled: ready && !!user, staleTime: 300000, refetchInterval: 1200000});
}
