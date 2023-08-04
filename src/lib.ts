import * as fs from "fs";
import {google} from "googleapis";
import * as admin from "firebase-admin";
import {Request, ResponseToolkit} from "@hapi/hapi";
import * as twilio from "twilio";
import {NodeMailgun} from 'ts-mailgun';
import {createHmac, randomBytes} from "crypto";
import {admins} from "./admins";
import * as Boom from "@hapi/boom";
import {MailgunTemplate} from "ts-mailgun/dist/mailgun-template";
import * as path from 'path';

const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/drive.appdata",
    "https://www.googleapis.com/auth/drive.metadata",
    "https://www.googleapis.com/auth/drive.photos.readonly",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.events.readonly"
];
const CRED_PATH = 'secrets/gsheets.json';
const FIREBASE_CRED_PATH = 'secrets/firebase.json';
const TWILIO_API_KEY_PATH = 'secrets/twilio.json';
const MAILGUN_API_KEY_PATH = 'secrets/mailgun.json';

const twilioApiKeys: any = JSON.parse(fs.readFileSync(TWILIO_API_KEY_PATH, 'utf8').toString())
const twilioApi = twilio(twilioApiKeys.accountSid, twilioApiKeys.authToken);

const mailGunApiKeys = JSON.parse(fs.readFileSync(MAILGUN_API_KEY_PATH, 'utf8').toString())
const mailGunApi = new NodeMailgun(mailGunApiKeys.apiKey, mailGunApiKeys.domain);
mailGunApi.fromEmail = mailGunApiKeys.from;
mailGunApi.fromTitle = mailGunApiKeys.fromTitle
mailGunApi.init();

const getTemplate = (templateName: string, subject: string): MailgunTemplate => {
    const mailgunTemplate = new MailgunTemplate()
    mailgunTemplate.body = fs.readFileSync(
        path.join(__dirname, `../templates/${templateName}.html`),
        {encoding: "utf8"})
    mailgunTemplate.subject = subject;
    return mailgunTemplate
}
mailGunApi.templates['ServiceSignupConfirmation'] = getTemplate('ServiceSignupConfirmation', "Sathya Sai Baba Center of Central San Jose - Thank you for signing up!");
mailGunApi.templates['DevotionSignupConfirmation'] = getTemplate('DevotionSignupConfirmation', "Sathya Sai Baba Center of Central San Jose - Thank you for signing up!");
mailGunApi.templates['BirthdayHomeBhajanSignupConfirmation'] = getTemplate('BirthdayHomeBhajanSignupConfirmation', "Sathya Sai Baba Center of Central San Jose - Thank you for signing up for hosting Swami at home on {{date}}!");

const SALT = randomBytes(Math.ceil(13 / 2)).toString('hex').slice(0, 13);

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

const generateHash = (str: string): string => {
    let hash = createHmac('sha512', SALT);
    hash.update(str);
    return hash.digest('hex');
}


const sendVerificationCode = async (req: Request, response: ResponseToolkit) => {
    const {phoneNumber} = (req.payload as any);
    const verificationCode = String((Math.random() * 100000).toFixed(0)).padStart(6, "0");
    const hashedVerificationCode = generateHash(`${phoneNumber}:${verificationCode}`);

    await twilioApi.messages.create({
        body: `Your SSSBCSJ Signup Verification Code is ${verificationCode}`,
        to: `+1${phoneNumber}`,
        from: twilioApiKeys.from
    })
        .then((message) => {
            console.log(`SMS was sent to ${message.to} from ${twilioApiKeys.from}. Message SID: ${message.sid}`);
        });
    return {verificationToken: hashedVerificationCode};
}

const verifySMSCode = async (req: Request, response: ResponseToolkit) => {
    const {verificationCode, verificationToken, phoneNumber} = (req.payload as any);

    const verificationCodeHash = generateHash(`${phoneNumber}:${verificationCode}`);
    if (verificationCodeHash !== verificationToken) {
        throw Boom.badRequest("Invalid verification code or token passed");
    }
    const user = req.auth.credentials.user as User;
    await admin
        .auth()
        .updateUser(user.uid, {
            phoneNumber: `+1${phoneNumber}`,
        });
    return true;
}

const sendSMS = async (messages: Array<{ to: string, message: string }>) => {
    for (const message of messages) {
        await twilioApi.messages.create({
            body: message.message,
            to: message.to,
            from: twilioApiKeys.from
        })
            .then((message) => {
                console.log(`SMS was sent to ${message.to} from ${twilioApiKeys.from}. Message SID: ${message.sid}`);
            });
    }
    return true;
}

const sendEMail = async (messages: Array<{ to: string | string[], subject: string, message: string }>) => {
    for (const message of messages) {
        await mailGunApi.send(message.to, message.subject, message.message).then(() => true);
    }
    return true;
}

const sendTemplateEMail = async (to: string | string[], template: string, params: any, cc = "") => {
    return mailGunApi.sendFromTemplate(to, mailGunApi.templates[template], params)
}


const isAdmin = (u: User) => {
    return admins.indexOf(u.email) !== -1;
}

export {
    authorize,
    initializeFirebase,
    sendVerificationCode,
    verifySMSCode,
    sendSMS,
    sendEMail,
    sendTemplateEMail,
    User,
    isAdmin
};
