'use client';
import {useQuery} from '@tanstack/react-query';
import {fetchWatermark} from '@/modules/configuracoes/marca-dagua/services/watermarkApi';
import {billingKeys} from '@/shared/query/keys';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {documentWatermark} from './documentWatermark';
import type {ReportOrientation} from './types';

export function useDocumentWatermark(orientation: ReportOrientation = 'portrait') {
  const {user, ready} = useAuth();
  const query = useQuery({queryKey: billingKeys.resource(user?.id ?? 'anonymous', 'watermarks'), queryFn: ({signal}) => fetchWatermark(signal), enabled: ready && !!user, staleTime: 300000, refetchInterval: 3000000});
  return {watermark: documentWatermark(query.data, orientation), loading: query.isPending, error: query.error?.message ?? '', reload: query.refetch};
}
