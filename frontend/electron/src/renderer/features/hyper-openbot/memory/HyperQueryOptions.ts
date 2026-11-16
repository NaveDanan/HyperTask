/** Lightweight option descriptors; native views reload after server mutations. */
export interface QueryClient { invalidateQueries(options: { queryKey: readonly unknown[] }): Promise<unknown> }
export function queryOptions<T>(options: { queryKey: readonly unknown[]; queryFn: () => Promise<T>; enabled?: boolean; retry?: boolean; refetchInterval?: number | ((query: { state: { data?: T } }) => number | false) }) { return options; }
export function mutationOptions<T, V>(options: { mutationFn: (variables: V) => Promise<T>; onSuccess?: (...args: never[]) => unknown; onSettled?: () => unknown; onError?: () => unknown }) { return options; }
