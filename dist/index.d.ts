/// <reference types="node" />
import * as WebSocket from 'ws';
interface Message {
    header: any;
    payload?: string | Buffer;
}
declare class Endpoint {
    id: string;
    private ws;
    isAlive: boolean;
    waiters: {
        endpointId: string;
        responseId: number;
    }[];
    constructor(id: string, ws: WebSocket);
    send(msg: Message): void;
    keepAlive(): void;
}
interface Provider {
    endpoint: Endpoint;
    capabilities: Set<string>;
    priority: number;
    httpHeaders: string[];
}
declare class ProviderRegistry {
    readonly registry: {
        [key: string]: Provider[];
    };
    readonly endpoints: Set<Endpoint>;
    constructor();
    add(endpoint: Endpoint, name: string, capabilities: string[], priority: number, httpHeaders: string[]): void;
    remove(endpoint: Endpoint): void;
    find(name: string, requiredCapabilities: string[] | null): Provider[] | null;
    cleanup(): void;
}
export declare const providerRegistry: ProviderRegistry;
export declare function messageFromString(str: string): Message;
export declare function messageFromBuffer(buf: Buffer): Message;
export declare function pickRandom<T>(list: Array<T>): T;
export declare function shutdown(): void;
export {};
