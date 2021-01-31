import * as fs from "fs";
import {google} from "googleapis";
import * as admin from "firebase-admin";
import {Request, ResponseToolkit} from "@hapi/hapi";

const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/drive.appdata",
    "https://www.googleapis.com/auth/drive.metadata",
    "https://www.googleapis.com/auth/drive.photos.readonly"
];
const CRED_PATH = 'secrets/gsheets.json';
const FIREBASE_CRED_PATH = 'secrets/firebase.json';
const GOOGLE_API_KEY_PATH = 'secrets/google.api.key.txt';


interface User {
    uid: string;
    email: string;
    phoneNumber: string;
    name: string;
}

const authorize = () => {
    const cred: any = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8').toString())
    const {client_email, private_key, private_key_id} = cred;
    const oAuth2Client = new google.auth.JWT({
        email: client_email,
        key: private_key,
        keyId: private_key_id,
        scopes: SCOPES
    });
    google.options({
        auth: oAuth2Client
    });
    return oAuth2Client;
}

const initializeFirebase = () => {
    const serviceAccount: any = JSON.parse(fs.readFileSync(FIREBASE_CRED_PATH, 'utf8').toString())
    const app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    app.auth()
}

const sendVerificationCode = async (req: Request, response: ResponseToolkit) => {
    const body = (req.payload as any);
    console.log(body);
    const identityToolkit = google.identitytoolkit({
        auth: fs.readFileSync(GOOGLE_API_KEY_PATH).toString(),
        version: 'v3',
    });


    const identityResponse = await identityToolkit.relyingparty.sendVerificationCode({
        requestBody: {
            phoneNumber: body.phoneNumber,
            recaptchaToken: body.recaptchaToken
        }
    });

    // save sessionInfo into db. You will need this to verify the SMS code
    const sessionInfo = identityResponse.data.sessionInfo;
    return {verificationToken: sessionInfo};
}

const verifySMSCode = async (req: Request, response: ResponseToolkit) => {
    const body = (req.payload as any);
    const identityToolkit = google.identitytoolkit({
        auth: fs.readFileSync(GOOGLE_API_KEY_PATH).toString(),
        version: 'v3',
    });

    const verificationResponse = await identityToolkit.relyingparty.verifyPhoneNumber({
        requestBody: {
            code: body.verificationCode,
            sessionInfo: body.verificationToken
        }
    });

    const user = req.auth.credentials.user as User;
    await admin
        .auth()
        .updateUser(user.uid, {
            phoneNumber: verificationResponse.data.phoneNumber,
        });
    return true;
}

export {authorize, initializeFirebase, sendVerificationCode, verifySMSCode, User};
