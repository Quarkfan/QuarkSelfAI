import { isAbsolute, resolve } from 'node:path'

/** Conservative UTF-8 byte bound shared by macOS and Linux sockaddr_un paths. */
export const MAX_PORTABLE_UNIX_SOCKET_PATH_BYTES = 103

export function exactPortableUnixSocketPathV1(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || /[\r\n\0]/.test(value) || Buffer.byteLength(value, 'utf8') > MAX_PORTABLE_UNIX_SOCKET_PATH_BYTES) throw new Error('Unix socket path is not portable')
  return value
}
