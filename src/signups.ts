import {google} from "googleapis";
import {Request, ResponseToolkit} from "@hapi/hapi";
import {authorize, isAdmin, User} from "./lib";
import {isEmpty} from "lodash";
import * as dateFormat from "dateformat";
import * as csvWriter from 'csv-write-stream';
import {Writable} from "stream";

interface ParsedSheet {
    spreadsheetId: string;
    spreadSheetTitle: string;
    sheetTitle: string;
    date: Date;
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
    title: string;
    description: string;
    signupItems: Array<SignupItem>;
    signees?: Array<Signee>;
    spreadsheetId: string;
    sheetTitle: string;
}

interface Signup {
    spreadSheetId: string;
    sheetTitle: string;
    itemIndex: number;
    itemCount: number;
}

interface Signee extends SignupItem {
    name: string;
    phoneNumber: string;
    email: string;
    signedUpOn: Date;
}


const findIndex = (values: any[][], valueToSearchFor: string) => {
    const vs = valueToSearchFor.toLowerCase();
    return values.findIndex(v => (v[0] || "").toString().toLowerCase().trim().indexOf(vs) !== -1);
}

const SIGNED_UP_ON_INDEX = 0;
const ITEM_INDEX = 1;
const QUANTITY_INDEX = 2;
const ITEM_COUNT_INDEX = 3;
const NAME_INDEX = 4;
const PHONE_NUMBER_INDEX = 5;
const EMAIL_INDEX = 6;
const NOTES_INDEX = 7;

async function getSignupSheets(getAllSheetsForExport: boolean) {
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
                if (getAllSheetsForExport || date.getTime() >= now.getTime()) {
                    const ps: ParsedSheet =
                        {
                            date,
                            spreadSheetTitle: s.data.properties.title,
                            spreadsheetId: signupSpreadsheet.id,
                            sheetTitle: s1.properties.title
                        };
                    return ps;
                }
            }
            return null;
        }).filter(s1 => s1 !== null);
        parsedSheets.splice(parsedSheets.length, 0, ...sheetsFromThisSpreadsheet);
    }
    return parsedSheets;
}

const listSignupSheets = async (req: Request, response: ResponseToolkit) => {
    const getAllSheetsForExport = false;
    return await getSignupSheets(getAllSheetsForExport);
}

async function getSignupSheet(spreadSheetId, sheetTitle, user: User): Promise<SignupSheet | null> {
    const gsheets = google.sheets({version: 'v4'});
    const spreadsheet = await gsheets.spreadsheets.values.get({
        spreadsheetId: spreadSheetId,
        range: sheetTitle
    });
    const values = spreadsheet.data.values;
    const dateAt = findIndex(values, "date");
    const locationAt = findIndex(values, "location");
    const tagsAt = findIndex(values, "tags");
    const descriptionAt = findIndex(values, "description");
    const serviceTitleAt = findIndex(values, "title");
    const signupsStartAt = findIndex(values, "#");
    const isAnAdmin = isAdmin(user);
    if (dateAt !== -1 && dateAt < signupsStartAt
        && serviceTitleAt !== -1 && serviceTitleAt < signupsStartAt
        && locationAt !== -1 && locationAt < signupsStartAt
        && descriptionAt !== -1 && descriptionAt < signupsStartAt) {
        const signupItems = new Array<SignupItem>();
        const signees = new Array<Signee>();
        values.forEach((v, index) => {
            if (index <= signupsStartAt) {
                return null;
            }
            const name = (v[NAME_INDEX] || "").toString().trim();
            const email = (v[EMAIL_INDEX] || "").toString().trim();
            const phoneNumber = (v[PHONE_NUMBER_INDEX] || "").toString().trim();
            const item = (v[ITEM_INDEX] || "").toString().trim();
            const quantity = (v[QUANTITY_INDEX] || "").toString().trim();
            const itemCount = parseInt((v[ITEM_COUNT_INDEX] || "").toString().trim(), 10);
            const notes = (v[NOTES_INDEX] || "").toString().trim();
            const signup: SignupItem = {
                item,
                itemIndex: index + 1,
                quantity,
                itemCount,
                notes
            };
            if (isEmpty(name) && isEmpty(email) && isEmpty(phoneNumber)) {
                if (itemCount > 0) {
                    signupItems.push(signup);
                }
            } else {
                if (isAnAdmin || email === user.email) {
                    const signee: Signee = {
                        ...signup,
                        signedUpOn: new Date(v[SIGNED_UP_ON_INDEX]),
                        name,
                        email,
                        phoneNumber
                    }
                    signees.push(signee);
                }
            }
        })
        let tags = [];
        if (tagsAt !== -1 && tagsAt <= signupsStartAt) {
            values[tagsAt].shift();
            tags = (values[tagsAt] || []).join("").toString().trim().split(",").map(t => t.trim().toLowerCase());
        }
        values[descriptionAt].shift();
        const ss: SignupSheet = {
            title: values[serviceTitleAt][1] || "",
            date: values[dateAt][1] || "",
            location: values[locationAt][1] || "",
            description: values[descriptionAt].join(" "),
            spreadsheetId: spreadSheetId,
            sheetTitle: sheetTitle,
            signupItems: signupItems,
            signees: isAnAdmin ? signees : null,
            tags
        }
        return ss;
    }
    return null;
}

const saveSignup = async (req: Request, h: ResponseToolkit) => {
    const signupToSave: Signup = (req.payload as Signup);
    const user = (req.auth.credentials.user as User)
    const gsheets = await google.sheets({version: "v4"});
    const response = await gsheets.spreadsheets.values.get({
        spreadsheetId: signupToSave.spreadSheetId,
        range: `'${signupToSave.sheetTitle}'!${signupToSave.itemIndex}:${signupToSave.itemIndex}`
    });
    const values = response.data.values;
    if (!isEmpty(values)) {
        const signupRowInSheet = values[0];
        const itemCount = parseInt((signupRowInSheet[ITEM_COUNT_INDEX] || "").toString().trim(), 10);
        if (itemCount >= signupToSave.itemCount) {
            const newSignupRow = [...signupRowInSheet];
            newSignupRow[SIGNED_UP_ON_INDEX] = dateFormat(new Date(), "ddd, mmm/dd/yyyy hh:MM:ss.l TT Z");
            newSignupRow[ITEM_COUNT_INDEX] = signupToSave.itemCount;
            newSignupRow[NAME_INDEX] = user.name;
            newSignupRow[EMAIL_INDEX] = user.email;
            newSignupRow[PHONE_NUMBER_INDEX] = user.phoneNumber;
            await gsheets.spreadsheets.values.append({
                spreadsheetId: signupToSave.spreadSheetId,
                range: `${signupToSave.sheetTitle}`,
                requestBody: {
                    majorDimension: "ROWS",
                    values: [newSignupRow]
                },
                valueInputOption: "RAW"
            })

            signupRowInSheet[ITEM_COUNT_INDEX] = itemCount - signupToSave.itemCount;
            await gsheets.spreadsheets.values.update({
                spreadsheetId: signupToSave.spreadSheetId,
                range: `'${signupToSave.sheetTitle}'!${signupToSave.itemIndex}:${signupToSave.itemIndex}`,
                requestBody: {
                    majorDimension: "ROWS",
                    values: [signupRowInSheet]
                },
                valueInputOption: "RAW"
            })
        }
    }
    return true;
}

const listSignees = async (req: Request, h: ResponseToolkit) => {
    const {spreadSheetId, sheetTitle} = (req.payload as any);
    const gsheets = await google.sheets({version: "v4"});
    const response = await gsheets.spreadsheets.values.get({
        spreadsheetId: spreadSheetId,
        range: `'${sheetTitle}'`
    });
    const values = response.data.values;
    if (!isEmpty(values)) {
        return values.filter(v => {
            const name = (v[NAME_INDEX] || "").toString().trim();
            const email = (v[EMAIL_INDEX] || "").toString().trim();
            const phoneNumber = (v[PHONE_NUMBER_INDEX] || "").toString().trim();
            return !isEmpty(name) && !isEmpty(email) && !isEmpty(phoneNumber);
        });
    }
    return [];
}

const exportSignups = (req: Request, h: ResponseToolkit) => {
    const w = new Writable();
    const writer = new csvWriter({
        separator: ',',
        newline: '\n',
        headers: ["#", "Item", "Quantity", "Item Count", "Name", "Phone Number", "E-Mail", "Notes", "Title", "Description", "Drop Off Location", "Drop Off Date", "Tags"],
        sendHeaders: true
    });
    writer.pipe(w);
    return h.response(w);
};


export {listSignupSheets, getSignupSheet, saveSignup, getSignupSheets, exportSignups};
