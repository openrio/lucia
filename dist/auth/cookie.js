import { serializeCookie } from "../utils/cookie.js";
export const DEFAULT_SESSION_COOKIE_NAME = "auth_session";
const defaultSessionCookieAttributes = {
    sameSite: "lax",
    path: "/"
};
export const createSessionCookie = (session, options) => {
    let expires;
    if (session === null) {
        expires = 0;
    }
    else if (options.cookie.expires !== false) {
        expires = session.idlePeriodExpiresAt.getTime();
    }
    else {
        expires = Date.now() + 1000 * 60 * 60 * 24 * 365; // + 1 year
    }
    return new Cookie(options.cookie.name ?? DEFAULT_SESSION_COOKIE_NAME, session?.sessionId ?? "", {
        ...(options.cookie.attributes ?? defaultSessionCookieAttributes),
        httpOnly: true,
        // expires: new Date(expires),
        secure: options.env === "PROD"
    });
};
export class Cookie {
    constructor(name, value, options) {
        this.name = name;
        this.value = value;
        this.attributes = options;
    }
    name;
    value;
    attributes;
    serialize = () => {
        return serializeCookie(this.name, this.value, this.attributes);
    };
}
