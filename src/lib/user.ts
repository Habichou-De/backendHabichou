import type { User } from '@prisma/client';

export type SafeUser = Omit<User, 'password_hash'>;

export function toSafeUser(user: User): SafeUser {
  const { password_hash: _hash, ...safe } = user;
  return safe;
}
