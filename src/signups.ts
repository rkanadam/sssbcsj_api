import {google} from "googleapis";
import {Request, ResponseToolkit} from "@hapi/hapi";
import {authorize, User} from "./lib";
import {isEmpty} from "lodash";

interface ParsedSheet {
    spreadsheetId: string;
    sheetId: number;
    sheetTitle: string;
    date: Date;
    data: any[][];
}

interface SignupItem {
    item: string;
    itemIndex: number;
    quantity: string;
    itemCount: number;
    notes: string;
}

interface SignupSheet {
    date: string;
    location: string;
    tags: string[];
    description: string;
    signups: Array<SignupItem>;
    spreadsheetId: string;
    sheetId: number;
}

interface Signup {
    spreadSheetId: string;
    sheetId: string;
    itemIndex: string;
    itemCount: number;
}


const findIndex = (values: any[][], valueToSearchFor: string) => {
    const vs = valueToSearchFor.toLowerCase();
    return values.findIndex(v => (v[0] || "").toString().toLowerCase().trim().indexOf(vs) !== -1);
}

const ITEM_INDEX = 1;
const QUANTITY_INDEX = 2;
const ITEM_COUNT_INDEX = 3;
const NAME_INDEX = 4;
const PHONE_NUMBER_INDEX = 5;
const EMAIL_INDEX = 6;
const NOTES_INDEX = 7;

const listSignupSheets = async (req: Request, response: ResponseToolkit) => {
    const tag = (isEmpty(req.query) || isEmpty(req.query.tag) ? "" : req.query.tag.toString()).trim().toLowerCase();
    const spreadsheets = await google.drive({version: 'v3', auth: authorize()}).files.list({
        spaces: "drive",
        q: "mimeType='application/vnd.google-apps.spreadsheet'"
    });
    const signupSpreadsheets = (spreadsheets.data.files || [])
        .filter(f => f.name.toLowerCase().trim().replace(/[^0-9a-z]/, "").indexOf("signup") !== -1);
    const tmp = new Date();
    const now = new Date(`${tmp.getFullYear()}-${tmp.getMonth() > 9 ? "" : "0"}${tmp.getMonth() + 1}-${tmp.getDate()}`);
    //Tell me about time zones and problems

    const parsedSheets = new Array<ParsedSheet>();
    for (const signupSpreadsheet of signupSpreadsheets) {
        const s = await google.sheets({version: "v4"}).spreadsheets.get({
            spreadsheetId: signupSpreadsheet.id,
            includeGridData: false
        })
        const sheetsFromThisSpreadsheet = s.data.sheets.map(s1 => {
            const dateMatch = /\d{4}-\d{2}-\d{2}/.exec(s1.properties.title);
            if (dateMatch) {
                const date = new Date(dateMatch[0]);
                if (date.getTime() >= now.getTime()) {
                    const ps: ParsedSheet =
                        {
                            date,
                            spreadsheetId: signupSpreadsheet.id,
                            sheetId: s1.properties.sheetId,
                            sheetTitle: s1.properties.title,
                            data: null
                        };
                    return ps;
                }
            }
            return null;
        }).filter(s1 => s1 !== null);
        parsedSheets.splice(parsedSheets.length, 0, ...sheetsFromThisSpreadsheet);
    }
    const gsheets = google.sheets({version: 'v4'});
    const signupSheets = new Array<SignupSheet>();
    for (const parsedSheet of parsedSheets) {
        const spreadsheet = await gsheets.spreadsheets.values.get({
            spreadsheetId: parsedSheet.spreadsheetId,
            range: `${parsedSheet.sheetTitle}`
        });
        const values = spreadsheet.data.values;
        const dateAt = findIndex(values, "date");
        const locationAt = findIndex(values, "location");
        const tagsAt = findIndex(values, "tags");
        const descriptionAt = findIndex(values, "description");
        const signupsStartAt = findIndex(values, "#");
        if (dateAt !== -1 && dateAt < signupsStartAt
            && locationAt !== -1 && locationAt < signupsStartAt
            && descriptionAt !== -1 && descriptionAt < signupsStartAt) {
            const signups = values.map((v, index) => {
                if (index <= signupsStartAt) {
                    return null;
                }
                const name = (v[NAME_INDEX] || "").toString().trim();
                const email = (v[EMAIL_INDEX] || "").toString().trim();
                const phoneNumber = (v[PHONE_NUMBER_INDEX] || "").toString().trim();
                if (isEmpty(name) && isEmpty(email) && isEmpty(phoneNumber)) {
                    const item = (v[ITEM_INDEX] || "").toString().trim();
                    const quantity = (v[QUANTITY_INDEX] || "").toString().trim();
                    const itemCount = parseInt((v[ITEM_COUNT_INDEX] || "").toString().trim(), 10);
                    if (itemCount > 0) {
                        const notes = (v[NOTES_INDEX] || "").toString().trim();
                        const signup: SignupItem = {
                            item,
                            itemIndex: index,
                            quantity,
                            itemCount,
                            notes
                        };
                        return signup;
                    }
                }
            }).filter(s => s);
            let tags = [];
            if (tagsAt !== -1 && tagsAt <= signupsStartAt) {
                values[tagsAt].shift();
                tags = (values[tagsAt] || []).join("").toString().trim().split(",").map(t => t.trim().toLowerCase());
            }
            //Either no tag is specified or the current tags contain the specified tag
            if (isEmpty(tag) || tags.indexOf(tag) !== -1) {
                values[descriptionAt].shift();
                const ss: SignupSheet = {
                    date: values[dateAt][1] || "",
                    location: values[locationAt][1] || "",
                    description: values[descriptionAt].join(" "),
                    spreadsheetId: parsedSheet.spreadsheetId,
                    sheetId: parsedSheet.sheetId,
                    signups,
                    tags
                }
                signupSheets.push(ss);
            }
        }
    }
    return signupSheets;
}

const saveSignup = async (req: Request, response: ResponseToolkit) => {
    const signupToSave: Signup = (req.payload as Signup);
    const user = (req.auth.credentials.user as User)
    const gsheets = await google.sheets({version: "v4"});
    let values = gsheets.spreadsheets.values.get({
        spreadsheetId: signupToSave.spreadSheetId,
        range: `${signupToSave.sheetId}:${signupToSave.itemIndex}`
    });
    if (isEmpty(values)) {
        const v = values[0];
        const item = (v[ITEM_INDEX] || "").toString().trim();
        const quantity = (v[QUANTITY_INDEX] || "").toString().trim();
        const notes = (v[NOTES_INDEX] || "").toString().trim();
        const itemCount = parseInt((v[ITEM_COUNT_INDEX] || "").toString().trim(), 10);
        if (itemCount > signupToSave.itemCount) {
            const signupRowInSheet = [[...v]];
            signupToSave[ITEM_COUNT_INDEX] = signupToSave.itemCount;
            signupToSave[NAME_INDEX] = user.name;
            signupToSave[EMAIL_INDEX] = user.email;
            signupToSave[PHONE_NUMBER_INDEX] = user.phoneNumber;
            await gsheets.spreadsheets.values.append({
                spreadsheetId: signupToSave.spreadSheetId,
                range: `${signupToSave.sheetId}`,
                requestBody: {
                    majorDimension: "ROWS",
                    values: [signupRowInSheet]
                },
                valueInputOption: "RAW"
            })

            v[ITEM_COUNT_INDEX] = itemCount - signupToSave.itemCount;
            await gsheets.spreadsheets.values.update({
                spreadsheetId: signupToSave.spreadSheetId,
                range: `${signupToSave.sheetId}:${signupToSave.itemIndex}`,
                requestBody: {
                    majorDimension: "ROWS",
                    values: [signupRowInSheet]
                },
                valueInputOption: "RAW"
            })
        }
    }
}

export {listSignupSheets, saveSignup};
