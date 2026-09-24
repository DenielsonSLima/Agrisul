import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {RpcError} from '@/shared/supabase/rpc';

export const SESSION_ACTOR_CHANGED = 'BILLING_SESSION_ACTOR_CHANGED';

export async function assertSessionActor(
  expectedActorId?: string,
  unauthenticatedMessage = 'Entre para continuar.',
) {
  const {data: {session}, error} = await getSupabaseBrowserClient().auth.getSession();
  if (error || !session) throw new RpcError(unauthenticatedMessage, 401);

  const actorId = expectedActorId ?? session.user.id;
  if (!actorId || session.user.id !== actorId) {
    throw new RpcError(
      'Sua conta foi alterada durante a operação. Reabra o cadastro e tente novamente.',
      409,
      SESSION_ACTOR_CHANGED,
    );
  }
  return actorId;
}
