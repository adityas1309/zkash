'use client';

import { useMemo } from 'react';
import { useAuthWorkspace } from './useAuthWorkspace';

export interface User {
  id?: string;
  email?: string;
  username?: string;
  stellarPublicKey?: string;
  reputation?: number;
}

export function useUser() {
  const { workspace, loading, refresh } = useAuthWorkspace();
  const user = useMemo<User | null>(() => {
    if (!workspace.user) {
      return null;
    }
    return {
      id: workspace.user.id,
      email: workspace.user.email,
      username: workspace.user.username,
      stellarPublicKey: workspace.user.stellarPublicKey,
      reputation: workspace.user.reputation,
    };
  }, [workspace.user]);

  return { user, loading, refresh, workspace };
}
