declare module 'circomlibjs' {
  export function buildPoseidon(): Promise<{
    (arr: bigint[] | Uint8Array, state?: unknown, nOut?: number): Uint8Array | Uint8Array[];
    F?: unknown;
  }>;
}

declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: object,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: object; publicSignals: (string | number)[] }>;
  };
}
