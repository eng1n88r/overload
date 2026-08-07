import axios from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
});

export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; message?: string } | undefined;
    return data?.error ?? data?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
