import { DEFAULT_SESSION_COOKIE_NAME, createSessionCookie } from "./cookie.js";
import { logError } from "../utils/log.js";
import { generateScryptHash, validateScryptHash } from "../utils/crypto.js";
import { generateRandomString } from "../utils/crypto.js";
import { LuciaError } from "./error.js";
import { parseCookie } from "../utils/cookie.js";
import { isValidDatabaseSession } from "./session.js";
import { AuthRequest, transformRequestContext } from "./request.js";
import { lucia as defaultMiddleware } from "../middleware/index.js";
import { debug } from "../utils/debug.js";
import { isWithinExpiration } from "../utils/date.js";
import { createAdapter } from "./adapter.js";
import { createKeyId } from "./database.js";
import { isAllowedOrigin, safeParseUrl } from "../utils/url.js";
export const lucia = (config) => {
    return new Auth(config);
};
const validateConfiguration = (config) => {
    const adapterProvided = config.adapter;
    if (!adapterProvided) {
        logError('Adapter is not defined in configuration ("config.adapter")');
        process.exit(1);
    }
};
export class Auth {
    adapter;
    sessionCookieConfig;
    sessionExpiresIn;
    csrfProtection;
    env;
    passwordHash = {
        generate: generateScryptHash,
        validate: validateScryptHash
    };
    middleware = defaultMiddleware();
    experimental;
    constructor(config) {
        validateConfiguration(config);
        this.adapter = createAdapter(config.adapter);
        this.env = config.env;
        this.sessionExpiresIn = {
            activePeriod: config.sessionExpiresIn?.activePeriod ?? 1000 * 60 * 60 * 24,
            idlePeriod: config.sessionExpiresIn?.idlePeriod ?? 1000 * 60 * 60 * 24 * 14
        };
        this.getUserAttributes = (databaseUser) => {
            const defaultTransform = () => {
                return {};
            };
            const transform = config.getUserAttributes ?? defaultTransform;
            return transform(databaseUser);
        };
        this.getSessionAttributes = (databaseSession) => {
            const defaultTransform = () => {
                return {};
            };
            const transform = config.getSessionAttributes ?? defaultTransform;
            return transform(databaseSession);
        };
        this.csrfProtection = config.csrfProtection ?? true;
        this.sessionCookieConfig = config.sessionCookie ?? {};
        if (config.passwordHash) {
            this.passwordHash = config.passwordHash;
        }
        if (config.middleware) {
            this.middleware = config.middleware;
        }
        this.experimental = {
            debugMode: config.experimental?.debugMode ?? false
        };
        debug.init(this.experimental.debugMode);
    }
    getUserAttributes;
    getSessionAttributes;
    transformDatabaseUser = (databaseUser) => {
        const attributes = this.getUserAttributes(databaseUser);
        return {
            ...attributes,
            userId: databaseUser.id
        };
    };
    transformDatabaseKey = (databaseKey) => {
        const [providerId, ...providerUserIdSegments] = databaseKey.id.split(":");
        const providerUserId = providerUserIdSegments.join(":");
        const userId = databaseKey.user_id;
        const isPasswordDefined = !!databaseKey.hashed_password;
        return {
            providerId,
            providerUserId,
            userId,
            passwordDefined: isPasswordDefined
        };
    };
    transformDatabaseSession = (databaseSession, context) => {
        const attributes = this.getSessionAttributes(databaseSession);
        const active = isWithinExpiration(databaseSession.active_expires);
        return {
            ...attributes,
            user: context.user,
            sessionId: databaseSession.id,
            activePeriodExpiresAt: new Date(Number(databaseSession.active_expires)),
            idlePeriodExpiresAt: new Date(Number(databaseSession.idle_expires)),
            state: active ? "active" : "idle",
            fresh: context.fresh
        };
    };
    getDatabaseUser = async (userId) => {
        const databaseUser = await this.adapter.getUser(userId);
        if (!databaseUser) {
            throw new LuciaError("AUTH_INVALID_USER_ID");
        }
        return databaseUser;
    };
    getDatabaseSession = async (sessionId) => {
        const databaseSession = await this.adapter.getSession(sessionId);
        if (!databaseSession) {
            debug.session.fail("Session not found", sessionId);
            throw new LuciaError("AUTH_INVALID_SESSION_ID");
        }
        if (!isValidDatabaseSession(databaseSession)) {
            debug.session.fail(`Session expired at ${new Date(Number(databaseSession.idle_expires))}`, sessionId);
            throw new LuciaError("AUTH_INVALID_SESSION_ID");
        }
        return databaseSession;
    };
    getDatabaseSessionAndUser = async (sessionId) => {
        if (this.adapter.getSessionAndUser) {
            const [databaseSession, databaseUser] = await this.adapter.getSessionAndUser(sessionId);
            if (!databaseSession) {
                debug.session.fail("Session not found", sessionId);
                throw new LuciaError("AUTH_INVALID_SESSION_ID");
            }
            if (!isValidDatabaseSession(databaseSession)) {
                debug.session.fail(`Session expired at ${new Date(Number(databaseSession.idle_expires))}`, sessionId);
                throw new LuciaError("AUTH_INVALID_SESSION_ID");
            }
            return [databaseSession, databaseUser];
        }
        const databaseSession = await this.getDatabaseSession(sessionId);
        const databaseUser = await this.getDatabaseUser(databaseSession.user_id);
        return [databaseSession, databaseUser];
    };
    validateSessionIdArgument = (sessionId) => {
        if (!sessionId) {
            debug.session.fail("Empty session id");
            throw new LuciaError("AUTH_INVALID_SESSION_ID");
        }
    };
    getNewSessionExpiration = (sessionExpiresIn) => {
        const activePeriodExpiresAt = new Date(new Date().getTime() +
            (sessionExpiresIn?.activePeriod ?? this.sessionExpiresIn.activePeriod));
        const idlePeriodExpiresAt = new Date(activePeriodExpiresAt.getTime() +
            (sessionExpiresIn?.idlePeriod ?? this.sessionExpiresIn.idlePeriod));
        return { activePeriodExpiresAt, idlePeriodExpiresAt };
    };
    getUser = async (userId) => {
        const databaseUser = await this.getDatabaseUser(userId);
        const user = this.transformDatabaseUser(databaseUser);
        return user;
    };
    createUser = async (options) => {
        const userId = options.userId ?? generateRandomString(15);
        const userAttributes = options.attributes ?? {};
        const databaseUser = {
            ...userAttributes,
            id: userId
        };
        if (options.key === null) {
            await this.adapter.setUser(databaseUser, null);
            return this.transformDatabaseUser(databaseUser);
        }
        const keyId = createKeyId(options.key.providerId, options.key.providerUserId);
        const password = options.key.password;
        const hashedPassword = password === null ? null : await this.passwordHash.generate(password);
        await this.adapter.setUser(databaseUser, {
            id: keyId,
            user_id: userId,
            hashed_password: hashedPassword
        });
        return this.transformDatabaseUser(databaseUser);
    };
    updateUserAttributes = async (userId, attributes) => {
        await this.adapter.updateUser(userId, attributes);
        return await this.getUser(userId);
    };
    deleteUser = async (userId) => {
        await this.adapter.deleteSessionsByUserId(userId);
        await this.adapter.deleteKeysByUserId(userId);
        await this.adapter.deleteUser(userId);
    };
    useKey = async (providerId, providerUserId, password) => {
        const keyId = createKeyId(providerId, providerUserId);
        const databaseKey = await this.adapter.getKey(keyId);
        if (!databaseKey) {
            debug.key.fail("Key not found", keyId);
            throw new LuciaError("AUTH_INVALID_KEY_ID");
        }
        const hashedPassword = databaseKey.hashed_password;
        if (hashedPassword !== null) {
            debug.key.info("Key includes password");
            if (!password) {
                debug.key.fail("Key password not provided", keyId);
                throw new LuciaError("AUTH_INVALID_PASSWORD");
            }
            const validPassword = await this.passwordHash.validate(password, hashedPassword);
            if (!validPassword) {
                debug.key.fail("Incorrect key password", password);
                throw new LuciaError("AUTH_INVALID_PASSWORD");
            }
            debug.key.notice("Validated key password");
        }
        else {
            if (password !== null) {
                debug.key.fail("Incorrect key password", password);
                throw new LuciaError("AUTH_INVALID_PASSWORD");
            }
            debug.key.info("No password included in key");
        }
        debug.key.success("Validated key", keyId);
        return this.transformDatabaseKey(databaseKey);
    };
    getSession = async (sessionId) => {
        this.validateSessionIdArgument(sessionId);
        const [databaseSession, databaseUser] = await this.getDatabaseSessionAndUser(sessionId);
        const user = this.transformDatabaseUser(databaseUser);
        return this.transformDatabaseSession(databaseSession, {
            user,
            fresh: false
        });
    };
    getAllUserSessions = async (userId) => {
        const [user, databaseSessions] = await Promise.all([
            this.getUser(userId),
            await this.adapter.getSessionsByUserId(userId)
        ]);
        const validStoredUserSessions = databaseSessions
            .filter((databaseSession) => {
            return isValidDatabaseSession(databaseSession);
        })
            .map((databaseSession) => {
            return this.transformDatabaseSession(databaseSession, {
                user,
                fresh: false
            });
        });
        return validStoredUserSessions;
    };
    validateSession = async (sessionId) => {
        this.validateSessionIdArgument(sessionId);
        const [databaseSession, databaseUser] = await this.getDatabaseSessionAndUser(sessionId);
        const user = this.transformDatabaseUser(databaseUser);
        const session = this.transformDatabaseSession(databaseSession, {
            user,
            fresh: false
        });
        if (session.state === "active") {
            debug.session.success("Validated session", session.sessionId);
            return session;
        }
        const { activePeriodExpiresAt, idlePeriodExpiresAt } = this.getNewSessionExpiration();
        await this.adapter.updateSession(session.sessionId, {
            active_expires: activePeriodExpiresAt.getTime(),
            idle_expires: idlePeriodExpiresAt.getTime()
        });
        const renewedDatabaseSession = {
            ...session,
            idlePeriodExpiresAt,
            activePeriodExpiresAt,
            fresh: true
        };
        return renewedDatabaseSession;
    };
    createSession = async (options) => {
        const { activePeriodExpiresAt, idlePeriodExpiresAt } = this.getNewSessionExpiration();
        const userId = options.userId;
        const sessionId = options?.sessionId ?? generateRandomString(40);
        const attributes = options.attributes;
        const databaseSession = {
            ...attributes,
            id: sessionId,
            user_id: userId,
            active_expires: activePeriodExpiresAt.getTime(),
            idle_expires: idlePeriodExpiresAt.getTime()
        };
        const [user] = await Promise.all([
            this.getUser(userId),
            this.adapter.setSession(databaseSession)
        ]);
        return this.transformDatabaseSession(databaseSession, {
            user,
            fresh: false
        });
    };
    updateSessionAttributes = async (sessionId, attributes) => {
        this.validateSessionIdArgument(sessionId);
        await this.adapter.updateSession(sessionId, attributes);
        return this.getSession(sessionId);
    };
    invalidateSession = async (sessionId) => {
        this.validateSessionIdArgument(sessionId);
        await this.adapter.deleteSession(sessionId);
        debug.session.notice("Invalidated session", sessionId);
    };
    invalidateAllUserSessions = async (userId) => {
        await this.adapter.deleteSessionsByUserId(userId);
    };
    deleteDeadUserSessions = async (userId) => {
        const databaseSessions = await this.adapter.getSessionsByUserId(userId);
        const deadSessionIds = databaseSessions
            .filter((databaseSession) => {
            return !isValidDatabaseSession(databaseSession);
        })
            .map((databaseSession) => databaseSession.id);
        await Promise.all(deadSessionIds.map((deadSessionId) => {
            this.adapter.deleteSession(deadSessionId);
        }));
    };
    /**
     * @deprecated To be removed in next major release
     */
    validateRequestOrigin = (request) => {
        if (request.method === null) {
            debug.request.fail("Request method unavailable");
            throw new LuciaError("AUTH_INVALID_REQUEST");
        }
        if (request.url === null) {
            debug.request.fail("Request url unavailable");
            throw new LuciaError("AUTH_INVALID_REQUEST");
        }
        if (request.method.toUpperCase() !== "GET" &&
            request.method.toUpperCase() !== "HEAD") {
            const requestOrigin = request.headers.origin;
            if (!requestOrigin) {
                debug.request.fail("No request origin available");
                throw new LuciaError("AUTH_INVALID_REQUEST");
            }
            try {
                const url = safeParseUrl(request.url);
                const allowedSubDomains = typeof this.csrfProtection === "object"
                    ? this.csrfProtection.allowedSubDomains ?? []
                    : [];
                if (url === null ||
                    !isAllowedOrigin(requestOrigin, url.origin, allowedSubDomains)) {
                    throw new LuciaError("AUTH_INVALID_REQUEST");
                }
                debug.request.info("Valid request origin", requestOrigin);
            }
            catch {
                debug.request.fail("Invalid origin string", requestOrigin);
                // failed to parse url
                throw new LuciaError("AUTH_INVALID_REQUEST");
            }
        }
        else {
            debug.request.notice("Skipping CSRF check");
        }
    };
    readSessionCookie = (cookieHeader) => {
        if (!cookieHeader) {
            debug.request.info("No session cookie found");
            return null;
        }
        const cookies = parseCookie(cookieHeader);
        const sessionCookieName = this.sessionCookieConfig.name ?? DEFAULT_SESSION_COOKIE_NAME;
        const sessionId = cookies[sessionCookieName] ?? null;
        if (sessionId) {
            debug.request.info("Found session cookie", sessionId);
        }
        else {
            debug.request.info("No session cookie found");
        }
        return sessionId;
    };
    readBearerToken = (authorizationHeader) => {
        if (!authorizationHeader) {
            debug.request.info("No token found in authorization header");
            return null;
        }
        const [authScheme, token] = authorizationHeader.split(" ");
        if (authScheme !== "Bearer") {
            debug.request.fail("Invalid authorization header auth scheme", authScheme);
            return null;
        }
        return token ?? null;
    };
    handleRequest = (
    // cant reference middleware type with Lucia.Auth
    ...args) => {
        const middleware = this.middleware;
        const sessionCookieName = this.sessionCookieConfig.name ?? DEFAULT_SESSION_COOKIE_NAME;
        return new AuthRequest(this, {
            csrfProtection: this.csrfProtection,
            requestContext: transformRequestContext(middleware({
                args,
                env: this.env,
                sessionCookieName: sessionCookieName
            }))
        });
    };
    createSessionCookie = (session) => {
        return createSessionCookie(session, {
            env: this.env,
            cookie: this.sessionCookieConfig
        });
    };
    createKey = async (options) => {
        const keyId = createKeyId(options.providerId, options.providerUserId);
        let hashedPassword = null;
        if (options.password !== null) {
            hashedPassword = await this.passwordHash.generate(options.password);
        }
        const userId = options.userId;
        await this.adapter.setKey({
            id: keyId,
            user_id: userId,
            hashed_password: hashedPassword
        });
        return {
            providerId: options.providerId,
            providerUserId: options.providerUserId,
            passwordDefined: !!options.password,
            userId
        };
    };
    deleteKey = async (providerId, providerUserId) => {
        const keyId = createKeyId(providerId, providerUserId);
        await this.adapter.deleteKey(keyId);
    };
    getKey = async (providerId, providerUserId) => {
        const keyId = createKeyId(providerId, providerUserId);
        const databaseKey = await this.adapter.getKey(keyId);
        if (!databaseKey) {
            throw new LuciaError("AUTH_INVALID_KEY_ID");
        }
        const key = this.transformDatabaseKey(databaseKey);
        return key;
    };
    getAllUserKeys = async (userId) => {
        const [databaseKeys] = await Promise.all([
            await this.adapter.getKeysByUserId(userId),
            this.getUser(userId)
        ]);
        return databaseKeys.map((databaseKey) => this.transformDatabaseKey(databaseKey));
    };
    updateKeyPassword = async (providerId, providerUserId, password) => {
        const keyId = createKeyId(providerId, providerUserId);
        const hashedPassword = password === null ? null : await this.passwordHash.generate(password);
        await this.adapter.updateKey(keyId, {
            hashed_password: hashedPassword
        });
        return await this.getKey(providerId, providerUserId);
    };
}
