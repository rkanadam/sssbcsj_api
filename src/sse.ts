import {isEmpty} from "lodash";
import {Request, ResponseToolkit} from "@hapi/hapi";
import {google} from "googleapis";

const SHEET_NAME = '2024 Registration';
const properties = [
    'year',
    'firstnameofchild',
    'lastnameofchild',
    'schoolgradeofchild',
    'emailofchild',
    'phonenumberofchild',
    'fathersfirstname',
    'fatherslastname',
    'fathersemail',
    'fathersphone',
    'mothersfirstname',
    'motherslastname',
    'mothersemail',
    'mothersphone',
    'expectations',
    'interesting',
    'notinteresting',
    'change',
    'centercommunication',
    'bhajans',
    'covid19comments',
    'inperson',
    'instrument',
    'service'
];


async function getSSERegistrations(req: Request, response: ResponseToolkit) {
    const q = ((req.query as any)["q"] || "").toString().trim().toLocaleLowerCase();
    if (!isEmpty(q) && q.length >= 3) {
        const sheets = google.sheets({version: 'v4'});
        const values = await sheets.spreadsheets.values.get({
            spreadsheetId: '1jyMtDqvSoKgNy7wXmuE_mqQ4K_I7EL7O96BDDz_AMM4',
            range: `${SHEET_NAME}!A:Z`
        });
        if (values && values.data) {
            const propertiesToClear = ["fathersemail", "fathersphone", "mothersemail", "mothersphone", "emailofchild", "phonenumberofchild"];
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
        const sheets = google.sheets({version: 'v4'});
        for (const registration of registrations) {
            const range = registration[0] || "";
            registration[0] = "2024";
            if (isEmpty(range)) {
                await sheets.spreadsheets.values.append({
                    spreadsheetId: '1jyMtDqvSoKgNy7wXmuE_mqQ4K_I7EL7O96BDDz_AMM4',
                    range: `${SHEET_NAME}!A:Z`,
                    requestBody: {
                        majorDimension: "ROWS",
                        values: [registration]
                    },
                    valueInputOption: "RAW"
                });
            } else {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: '1jyMtDqvSoKgNy7wXmuE_mqQ4K_I7EL7O96BDDz_AMM4',
                    range: `${SHEET_NAME}!${range}:${range}`,
                    requestBody: {
                        majorDimension: "ROWS",
                        values: [registration]
                    },
                    valueInputOption: "RAW"
                })
            }
        }
    }
    return true;
}


export {getSSERegistrations, saveSSERegistrations};
