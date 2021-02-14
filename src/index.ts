import {Lifecycle, Request, ResponseObject, ResponseToolkit, Server, ServerAuthSchemeObject} from "@hapi/hapi";
import {getSSERegistrations, saveSSERegistrations} from "./sse";
import {
    authorize,
    initializeFirebase,
    isAdmin,
    sendEMail,
    sendSMS,
    sendVerificationCode,
    User,
    verifySMSCode
} from "./lib";
import {exportSignups, getDetailedSignupSheet, getSummarizedSignupSheets, getUserSignups, saveSignup} from "./signups";
import {isEmpty} from "lodash";
import * as yar from "@hapi/yar";
import firebase from "firebase";
import * as admin from "firebase-admin";
import * as BoomPlugin from "@hapi/boom";
import {Boom} from "@hapi/boom";
import * as blipp from "blipp";
import * as Joi from "joi";
import {admins} from "./admins";
import * as dateFormat from "dateformat";
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
            },
            validate: {
                failAction: async (request, h, err) => {
                    console.error('ValidationError:', err.message, err.stack);
                    throw err;
                }
            }
        }
    });
    server.auth.scheme("firebase", (server: Server, options: any): ServerAuthSchemeObject => {
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
                    if (options.adminsOnly) {
                        if (admins.indexOf(user.email) === -1) {
                            throw BoomPlugin.unauthorized("This functionality is limited to administrators", 'admins');
                        }
                    }
                    request.yar.set({user})
                    return h.authenticated({
                        credentials: {
                            user
                        }
                    });
                } else {
                    const user = request.yar.get("user");
                    if (options.adminsOnly) {
                        if (admins.indexOf(user.email) === -1) {
                            throw BoomPlugin.unauthorized("This functionality is limited to administrators", 'admins');
                        }
                    }
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
    server.auth.strategy('admin', 'firebase', {
        adminsOnly: true
    });

    server.auth.default('firebase');

    server.route({
        method: 'GET',
        path: '/sse',
        handler: getSSERegistrations,
        options: {
            auth: false,
            validate: {
                query: Joi.object({
                    q: Joi.string().min(3).max(255).optional().default("")
                }).options({stripUnknown: true})
            }
        }
    });
    server.route({
        method: 'POST',
        path: '/sse',
        options: {
            auth: false
        },
        handler: saveSSERegistrations
    });
    server.route({
        method: 'GET',
        path: '/signups:summarised',
        handler: (req: Request) => {
            return getSummarizedSignupSheets(false);
        },
        options: {
            validate: {
                query: Joi.object({
                    tag: Joi.string().min(1).max(255).optional().default("")
                }).options({stripUnknown: true})
            }
        }
    });
    server.route({
        method: 'GET',
        path: '/signups:my',
        handler: (req: Request) => {
            const user = req.auth.credentials.user as User;
            return getUserSignups(user);
        },
        options: {
            validate: {
                query: Joi.object({
                    tag: Joi.string().min(1).max(255).optional().default("")
                }).options({stripUnknown: true})
            }
        }
    });
    server.route({
        method: 'POST',
        path: '/signups',
        handler: saveSignup,
        options: {
            validate: {
                payload: Joi.object({
                    spreadSheetId: Joi.string().min(1).max(255).required(),
                    sheetTitle: Joi.string().min(1).max(255).required(),
                    itemIndex: Joi.number().integer().min(0).required(),
                    itemCount: Joi.number().integer().min(0).required()
                }).options({stripUnknown: true})
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/profile/sendVerificationCode',
        handler: sendVerificationCode,
        options: {
            validate: {
                payload: Joi.object({
                    phoneNumber: Joi.string().length(10).required(),
                    recaptchaToken: Joi.string().min(10).max(4096).required()
                }).options({stripUnknown: true})
            }
        }
    });
    server.route({
        method: 'POST',
        path: '/profile/verifyPhoneSMSCode',
        handler: verifySMSCode,
        options: {
            validate: {
                payload: Joi.object({
                    phoneNumber: Joi.string().length(10).required(),
                    verificationCode: Joi.string().min(1).max(10).required(),
                    verificationToken: Joi.string().min(10).max(255).required()
                }).options({stripUnknown: true})
            }
        }
    });
    server.route({
        method: 'POST',
        path: '/sendSMS',
        handler: (req: Request) => {
            const smsMessages: Array<{ to, message }> = req.payload as any;
            return sendSMS(smsMessages);
        },
        options: {
            auth: 'admin',
            validate: {
                payload: Joi.array().items(
                    Joi.object({
                        message: Joi.string().min(1).max(1024).required(),
                        to: Joi.string().min(10).max(12).required()
                    })).options({stripUnknown: true})
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/sendEMail',
        handler: (req: Request) => {
            const messages: Array<{ to: string, subject: string, message: string }> = req.payload as any;
            return sendEMail(messages);
        },
        options: {
            auth: 'admin',
            validate: {
                payload: Joi.array().items(Joi.object({
                    message: Joi.string().min(10).max(10240).required(),
                    subject: Joi.string().min(5).max(512).required(),
                    to: Joi.string().min(5).max(255).required()
                })).options({stripUnknown: true})
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/export',
        handler: async (req: Request, h: ResponseToolkit) => {
            const user = req.auth.credentials.user as User;
            const stream = await exportSignups(user);
            const date = dateFormat(new Date(), "mmddyyyy_HHMMss")
            return h.response(stream)
                .type('text/css')
                .header('Content-type', 'text/css')
                .header("Content-Disposition", `attachment; filename=export_signups_${date}.csv;`)
        },
        options: {
            auth: 'admin'
        }
    });

    server.route({
        method: 'GET',
        path: '/isAdmin',
        handler: (req: Request, h: ResponseToolkit) => {
            const user = req.auth.credentials.user as User;
            return isAdmin(user);
        }
    });

    server.route({
        method: 'GET',
        path: '/signups:detailed/{spreadSheetId}/{sheetTitle}',
        handler: (req: Request) => {
            const {spreadSheetId, sheetTitle} = req.params as any;
            const user = req.auth.credentials.user as User;
            return getDetailedSignupSheet(spreadSheetId, sheetTitle, user);
        },
        options: {
            validate: {
                params: Joi.object({
                    spreadSheetId: Joi.string().min(5).max(1024).required(),
                    sheetTitle: Joi.string().min(5).max(255).required()
                }).options({stripUnknown: true})
            }
        }
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
                console.log("req: ", request.path, r.statusCode);
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
