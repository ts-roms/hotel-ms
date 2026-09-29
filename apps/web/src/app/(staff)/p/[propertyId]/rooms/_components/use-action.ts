import { useMutation } from '@tanstack/react-query';

/** A mutation that runs the given API call, then `onDone`; shared by the room forms. */
export function useAction(onDone: () => unknown) {
  return useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => onDone(),
  });
}
