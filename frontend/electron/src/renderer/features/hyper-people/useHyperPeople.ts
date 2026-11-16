import { useEffect, useState } from 'react';
import type { HyperPerson } from '@shared/api';
export function useHyperPeople(query: string) {
  const [state, setState] = useState<{ people: HyperPerson[]; loading: boolean; error: string | null }>({ people: [], loading: false, error: null });
  useEffect(() => {
    let alive = true;
    if (query.trim().length < 2) { setState({ people: [], loading: false, error: null }); return; }
    setState({ people: [], loading: true, error: null });
    const timer = setTimeout(() => {
      void window.hypertask.outlook.people.search({ query, limit: 20 }).then(result => {
        if (alive) setState(result.ok ? { people: result.value, loading: false, error: null } : { people: [], loading: false, error: result.message });
      }).catch(() => { if (alive) setState({ people: [], loading: false, error: 'Employee directory is unavailable. Try again on the company network.' }); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);
  return state;
}
