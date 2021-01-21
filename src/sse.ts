import * as fs from 'fs';
import {isEmpty} from "lodash";
import {google} from 'googleapis';
import {Request, ResponseToolkit} from "@hapi/hapi";

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const CRED_PATH = 'secrets/gsheets.json';
const SHEET_NAME = '2020 Registration';
const properties = [
    'ignore',
    'fathersfirstname',
    'fatherslastname',
    'fathersemail',
    'fathersphone',
    'mothersfirstname',
    'motherslastname',
    'mothersemail',
    'mothersphone',
    'firstnameofchild',
    'lastnameofchild',
    'ssegroupofchild',
    'schoolgradeofchild',
    'allergiesofchild',
    'comments',
    'centercommunication',
    'expectations',
    'interesting',
    'notinteresting',
    'change',
];


const authorize = (cred: any) => {
    const {client_email, private_key, private_key_id} = cred;
    const oAuth2Client = new google.auth.JWT({
        email: client_email,
        key: private_key,
        keyId: private_key_id,
        scopes: SCOPES,
    });
    return oAuth2Client;
}

const openSheet = () => {
    const auth = authorize(JSON.parse(fs.readFileSync(CRED_PATH, 'utf8')));
    google.options({
        auth
    });
    return google.sheets({version: 'v4', auth});
}

async function getSSERegistrations(req: Request, response: ResponseToolkit) {
    const q = (req.query as any)["q"].toString().trim().toLocaleLowerCase();
    if (!isEmpty(q) && q.length >= 3) {
        const sheets = openSheet();
        const values = await sheets.spreadsheets.values.get({
            spreadsheetId: '1jyMtDqvSoKgNy7wXmuE_mqQ4K_I7EL7O96BDDz_AMM4',
            range: `${SHEET_NAME}!A:Z`
        });
        if (values && values.data) {
            const propertiesToClear = ["fathersemail", "fathersphone", "mothersemail", "mothersphone"];
            const matchedCells = values.data.values
                .map((v, index) => {
                    v[0] = `${index + 1}`;
                    propertiesToClear.forEach((propertyToClear) => {
                        v[properties.indexOf(propertyToClear)] = "";
                    })
                    return v;
                })
                .filter(cells => cells.find(cell => cell && cell.toLowerCase() && cell.toLowerCase().indexOf(q) !== -1));
            return matchedCells;
        }
    }
    return [];
}

async function saveSSERegistrations(req: Request, response: ResponseToolkit) {
    const registrations = req.payload as Array<Array<string>>;
    if (!isEmpty(registrations) && registrations.length) {
        const sheets = openSheet();
        for (const registration of registrations) {
            const range = registration[0];
            if (isEmpty(range)) {
                const response = await sheets.spreadsheets.values.append({
                    spreadsheetId: '1jyMtDqvSoKgNy7wXmuE_mqQ4K_I7EL7O96BDDz_AMM4',
                    requestBody: {
                        majorDimension: "ROWS",
                        values: [registration]
                    },
                    valueInputOption: "RAW"
                }).catch(e => {
                    console.error(e);
                })
                console.log(response);
            } else {
                console.log(`${SHEET_NAME}!${range}:${range}`);
                const response = await sheets.spreadsheets.values.update({
                    spreadsheetId: '1jyMtDqvSoKgNy7wXmuE_mqQ4K_I7EL7O96BDDz_AMM4',
                    range: `${SHEET_NAME}!${range}:${range}`,
                    requestBody: {
                        majorDimension: "ROWS",
                        values: [registration]
                    },
                    valueInputOption: "RAW"
                }).catch(e => {
                    console.error(e);
                })
                console.log(response);
            }
        }
    }
    return true;
}


export {getSSERegistrations, saveSSERegistrations};
