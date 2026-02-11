declare module 'ffjavascript' {
    export function getCurveFromName(name: string, singleThread?: boolean, ...args: any[]): Promise<any>;
    export const Scalar: any;
    export class F1Field {
        constructor(p: any);
        e(n: any): any;
        toObject(a: any): bigint;
        toRprLEM(buff: Uint8Array, offset: number, a: any): void;
        add(a: any, b: any): any;
        sub(a: any, b: any): any;
        mul(a: any, b: any): any;
        square(a: any, b?: any): any;
        zero: any;
    }
}

declare module 'circomlibjs/src/poseidon_constants.js' {
    const constants: {
        C: string[][][];
        M: string[][][][];
        S: string[][][];
        P: string[][][][];
    };
    export default constants;
}
