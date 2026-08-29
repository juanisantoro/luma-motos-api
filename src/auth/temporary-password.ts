import { randomBytes } from 'node:crypto';

export function createTemporaryPassword(): string {
  return randomBytes(18).toString('base64url');
}
