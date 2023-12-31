import { AuthRequest } from "./request.js";
import { lucia as defaultMiddleware } from "../middleware/index.js";
import type { Cookie, SessionCookieConfiguration } from "./cookie.js";
import type { UserSchema, SessionSchema, KeySchema } from "./database.js";
import type { Adapter, SessionAdapter, InitializeAdapter } from "./adapter.js";
import type { Middleware } from "./request.js";
export type Session = Readonly<{
    user: User;
    sessionId: string;
    activePeriodExpiresAt: Date;
    idlePeriodExpiresAt: Date;
    state: "idle" | "active";
    fresh: boolean;
}> & ReturnType<Lucia.Auth["getSessionAttributes"]>;
export type Key = Readonly<{
    userId: string;
    providerId: string;
    providerUserId: string;
    passwordDefined: boolean;
}>;
export type Env = "DEV" | "PROD";
export type User = {
    userId: string;
} & ReturnType<Lucia.Auth["getUserAttributes"]>;
export declare const lucia: <_Configuration extends Configuration<{}, {}>>(config: _Configuration) => Auth<_Configuration>;
export declare class Auth<_Configuration extends Configuration = any> {
    private adapter;
    private sessionCookieConfig;
    private sessionExpiresIn;
    private csrfProtection;
    private env;
    private passwordHash;
    protected middleware: _Configuration["middleware"] extends Middleware ? _Configuration["middleware"] : ReturnType<typeof defaultMiddleware>;
    private experimental;
    constructor(config: _Configuration);
    protected getUserAttributes: (databaseUser: UserSchema) => _Configuration extends Configuration<infer _UserAttributes> ? _UserAttributes : never;
    protected getSessionAttributes: (databaseSession: SessionSchema) => _Configuration extends Configuration<any, infer _SessionAttributes> ? _SessionAttributes : never;
    transformDatabaseUser: (databaseUser: UserSchema) => User;
    transformDatabaseKey: (databaseKey: KeySchema) => Key;
    transformDatabaseSession: (databaseSession: SessionSchema, context: {
        user: User;
        fresh: boolean;
    }) => Session;
    private getDatabaseUser;
    private getDatabaseSession;
    private getDatabaseSessionAndUser;
    private validateSessionIdArgument;
    private getNewSessionExpiration;
    getUser: (userId: string) => Promise<User>;
    createUser: (options: {
        userId?: string;
        key: {
            providerId: string;
            providerUserId: string;
            password: string | null;
        } | null;
        attributes: Lucia.DatabaseUserAttributes;
    }) => Promise<User>;
    updateUserAttributes: (userId: string, attributes: Partial<Lucia.DatabaseUserAttributes>) => Promise<User>;
    deleteUser: (userId: string) => Promise<void>;
    useKey: (providerId: string, providerUserId: string, password: string | null) => Promise<Key>;
    getSession: (sessionId: string) => Promise<Session>;
    getAllUserSessions: (userId: string) => Promise<Session[]>;
    validateSession: (sessionId: string) => Promise<Session>;
    createSession: (options: {
        sessionId?: string;
        userId: string;
        attributes: Lucia.DatabaseSessionAttributes;
    }) => Promise<Session>;
    updateSessionAttributes: (sessionId: string, attributes: Partial<Lucia.DatabaseSessionAttributes>) => Promise<Session>;
    invalidateSession: (sessionId: string) => Promise<void>;
    invalidateAllUserSessions: (userId: string) => Promise<void>;
    deleteDeadUserSessions: (userId: string) => Promise<void>;
    /**
     * @deprecated To be removed in next major release
     */
    validateRequestOrigin: (request: {
        url: string | null;
        method: string | null;
        headers: {
            origin: string | null;
        };
    }) => void;
    readSessionCookie: (cookieHeader: string | null | undefined) => string | null;
    readBearerToken: (authorizationHeader: string | null | undefined) => string | null;
    handleRequest: (...args: (_Configuration["middleware"] extends Middleware ? _Configuration["middleware"] : Middleware<[import("./request.js").RequestContext]>) extends Middleware<infer Args extends any[]> ? Args : never) => AuthRequest<Lucia.Auth>;
    createSessionCookie: (session: Session | null) => Cookie;
    createKey: (options: {
        userId: string;
        providerId: string;
        providerUserId: string;
        password: string | null;
    }) => Promise<Key>;
    deleteKey: (providerId: string, providerUserId: string) => Promise<void>;
    getKey: (providerId: string, providerUserId: string) => Promise<Key>;
    getAllUserKeys: (userId: string) => Promise<Key[]>;
    updateKeyPassword: (providerId: string, providerUserId: string, password: string | null) => Promise<Key>;
}
type MaybePromise<T> = T | Promise<T>;
export type Configuration<_UserAttributes extends Record<string, any> = {}, _SessionAttributes extends Record<string, any> = {}> = {
    adapter: InitializeAdapter<Adapter> | {
        user: InitializeAdapter<Adapter>;
        session: InitializeAdapter<SessionAdapter>;
    };
    env: Env;
    middleware?: Middleware;
    csrfProtection?: boolean | {
        host?: string;
        hostHeader?: string;
        allowedSubDomains?: string[] | "*";
    };
    sessionExpiresIn?: {
        activePeriod: number;
        idlePeriod: number;
    };
    sessionCookie?: SessionCookieConfiguration;
    getSessionAttributes?: (databaseSession: SessionSchema) => _SessionAttributes;
    getUserAttributes?: (databaseUser: UserSchema) => _UserAttributes;
    passwordHash?: {
        generate: (password: string) => MaybePromise<string>;
        validate: (password: string, hash: string) => MaybePromise<boolean>;
    };
    experimental?: {
        debugMode?: boolean;
    };
};
export {};
