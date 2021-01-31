import {
    Lifecycle,
    Request,
    ResponseObject,
    ResponseToolkit,
    Server,
    ServerAuthSchemeObject,
    ServerAuthSchemeOptions
} from "@hapi/hapi";
import {getSSERegistrations, saveSSERegistrations} from "./sse";
import {authorize, initializeFirebase, sendVerificationCode, User, verifySMSCode} from "./lib";
import {listSignupSheets, saveSignup} from "./signups";
import {isEmpty} from "lodash";
import * as yar from "@hapi/yar";
import firebase from "firebase";
import * as admin from "firebase-admin";
import * as BoomPlugin from "@hapi/boom";
import {Boom} from "@hapi/boom";
import * as blipp from "blipp";
import ReturnValue = Lifecycle.ReturnValue;

const init = async () => {
    const server: Server = new Server({
        port: 3006,
        host: 'localhost',
        routes: {
            cors: {
                origin: ['http://region7saicenters.org', 'https://region7saicenters.org', 'http://localhost:4200'],
                additionalHeaders: ["bearer", "content-type"],
                credentials: true
            }
        }
    });
    server.auth.scheme("firebase", (server: Server, options?: ServerAuthSchemeOptions): ServerAuthSchemeObject => {
        const scheme: ServerAuthSchemeObject = {
            authenticate: async (request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> => {
                if (!request.yar.get("user")) {
                    const bearer: string = (request.headers["bearer"] || "").toString().trim();
                    if (isEmpty(bearer) || !bearer.startsWith("firebase")) {
                        throw BoomPlugin.unauthorized("No bearer token present", 'firebase');
                    }
                    const idToken = bearer.substr(bearer.indexOf(' ')).trim();
                    const decodedToken = await admin
                        .auth()
                        .verifyIdToken(idToken);

                    const user: User = {
                        uid: decodedToken.uid,
                        email: decodedToken.email,
                        phoneNumber: decodedToken.phone_number,
                        name: decodedToken.name
                    };
                    request.yar.set({user})
                    return h.authenticated({
                        credentials: {
                            user
                        }
                    });
                } else {
                    const user = request.yar.get("user");
                    return h.authenticated({
                        credentials: {
                            user
                        }
                    });
                }
            }
        }
        return scheme;
    });

    server.auth.strategy('firebase', 'firebase', {});

    server.auth.default('firebase');

    server.route({
        method: 'GET',
        path: '/sse',
        handler: getSSERegistrations
    });
    server.route({
        method: 'POST',
        path: '/sse',
        handler: saveSSERegistrations
    });
    server.route({
        method: 'GET',
        path: '/signups',
        handler: listSignupSheets
    });
    server.route({
        method: 'POST',
        path: '/signups',
        handler: saveSignup
    });

    server.route({
        method: 'POST',
        path: '/profile/sendVerificationCode',
        handler: sendVerificationCode
    });
    server.route({
        method: 'POST',
        path: '/profile/verifyPhoneSMSCode',
        handler: verifySMSCode
    });


    initializeFirebase();
    await authorize();
    await server.register({
        plugin: yar,
        options: {
            storeBlank: false,
            maxCookieSize: 2048,
            cache: {
                expiresIn: 30 * 60 * 1000
            },
            cookieOptions: {
                password: 'ab5d6f066d3818594a98d373d2a888c4aebed4175581a02df920a92b1ddaf22a9f561c464f66915dce8d5bd86a0fb51e4c58f61410f9b4cf108c5acfdbfc2fd1',
                isSecure: process.env.NODE_ENV !== 'development',
                isSameSite: 'Lax',
            }
        }
    });
    await server.register({
        plugin: blipp
    });

    server.ext('onPreResponse', (request: Request, h: ResponseToolkit): ReturnValue => {
        const b = request.response as Boom;
        if (b.isBoom) {
            console.error("Boom error", b.message, b, b.stack);
        } else {
            const r = request.response as ResponseObject;
            if (r.statusCode >= 200 && r.statusCode < 300) {
            } else {
                console.error("Path", request.path, "Status Code", r.statusCode);
            }
        }
        return h.continue;
    });

    await server.start();
    console.log('Server running on %s', server.info.uri);
    console.log((server.plugins as any).blipp.text());

};
process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
});
init();
