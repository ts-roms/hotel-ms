import type { Folio } from '@hotel/contracts';
import { useQueryClient } from '@tanstack/react-query';

/** Refetch the folio after a change whose result the API does not return. */
export function useRefreshFolio(propertyId: string, folioId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['folio', propertyId, folioId] });
}

/** Put the folio returned by a change straight into the cache. */
export function useSetFolio(propertyId: string, folioId: string) {
  const queryClient = useQueryClient();
  return (data: Folio) => queryClient.setQueryData(['folio', propertyId, folioId], data);
}
