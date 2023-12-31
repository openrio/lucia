import type { Env, Session } from "./index.js";
import type { CookieAttributes } from "../utils/cookie.js";
export declare const DEFAULT_SESSION_COOKIE_NAME = "auth_session";
type SessionCookieAttributes = {
    sameSite?: "strict" | "lax";
    path?: string;
    domain?: string;
};
export type SessionCookieConfiguration = {
    name?: string;
    attributes?: SessionCookieAttributes;
    expires?: boolean;
};
export declare const createSessionCookie: (session: Session | null, options: {
    env: Env;
    cookie: SessionCookieConfiguration;
}) => Cookie;
export declare class Cookie {
    constructor(name: string, value: string, options: CookieAttributes);
    readonly name: string;
    readonly value: string;
    readonly attributes: CookieAttributes;
    readonly serialize: () => string;
}
export {};
