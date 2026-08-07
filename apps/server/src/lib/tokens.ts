import { createHash, randomBytes } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newApiKey(): string {
  return `ovl_${randomBytes(32).toString('base64url')}`;
}
