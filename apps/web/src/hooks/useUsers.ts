import { useEffect, useState } from 'react';

import { fetchUsers } from '@/lib/api';
import type { User } from '@/lib/types';

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState('');

  useEffect(() => {
    void fetchUsers().then(({ users }) => {
      const [firstUser] = users;

      setUsers(users);
      setUserId(firstUser?.id ?? '');
    });
  }, []);

  return { users, userId, setUserId };
}
