export declare const generateRandomString: (length: number, alphabet?: string) => string;
export declare const generateScryptHash: (s: string) => Promise<string>;
export declare const validateScryptHash: (s: string, hash: string) => Promise<boolean>;
export declare const convertUint8ArrayToHex: (arr: Uint8Array) => string;
