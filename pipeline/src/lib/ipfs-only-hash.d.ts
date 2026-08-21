declare module 'ipfs-only-hash' {
  export function of(data: Buffer | Uint8Array | string): Promise<string>;
}
