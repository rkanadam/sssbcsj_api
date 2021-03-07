import {google} from "googleapis";
import {Request, ResponseToolkit} from "@hapi/hapi";
import {authorize, isAdmin, sendTemplateEMail, User} from "./lib";
import {isEmpty} from "lodash";
import * as dateFormat from "dateformat";
import * as temp from "temp";
import * as stringify from 'csv-stringify';
import {createReadStream} from "fs";


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
    items: Array<{
        itemIndex: number;
        itemCount: number;
    }>;
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

async function getSummarizedServiceSignupSheets(getAllSheetsForExport: boolean) {
    const spreadsheets = await google.drive({version: 'v3', auth: authorize()}).files.list({
        spaces: "drive",
        q: "mimeType='application/vnd.google-apps.spreadsheet'"
    });
    const signupSpreadsheets = (spreadsheets.data.files || [])
        .filter(f => f.name.toLowerCase().trim().replace(/[^0-9a-z]/, "").indexOf("signup") !== -1);
    const now = new Date();
    now.setMilliseconds(0);
    now.setSeconds(0);
    now.setMinutes(0);
    now.setHours(0);

    const parsedSheets = new Array<ParsedSheet>();
    for (const signupSpreadsheet of signupSpreadsheets) {
        const s = await google.sheets({version: "v4"}).spreadsheets.get({
            spreadsheetId: signupSpreadsheet.id,
            includeGridData: false
        })
        const sheetsFromThisSpreadsheet = s.data.sheets.map(s1 => {
            const dateMatch = /\d{4}-\d{2}-\d{2}/.exec(s1.properties.title);
            if (dateMatch) {
                const date = new Date(`${dateMatch[0]} 00:00:00.00`);
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
    parsedSheets.sort((p1, p2) => p1.date.getTime() - p2.date.getTime());
    return parsedSheets;
}

const getUserServiceSignups = async (user: User) => {
    const summarizedSignupSheets = await getSummarizedServiceSignupSheets(false);
    const userSignups = new Array<SignupSheet>();
    for (const summarizedSignupSheet of summarizedSignupSheets) {
        const detailedSignupSheet = await getDetailedServiceSignupSheet(summarizedSignupSheet.spreadsheetId, summarizedSignupSheet.sheetTitle, user, false)
        if (!isEmpty(detailedSignupSheet) && !isEmpty(detailedSignupSheet.signees)) {
            userSignups.push(detailedSignupSheet);
        }
    }
    return userSignups;
}

async function getDetailedServiceSignupSheet(spreadSheetId, sheetTitle, user: User, listAllSignups = false): Promise<SignupSheet | null> {
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
                if ((listAllSignups && isAnAdmin) || isAnAdmin || email === user.email) {
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
            signees,
            tags
        }
        return ss;
    }
    return null;
}

const saveServiceSignup = async (signup: Signup, user: User) => {
    const gsheets = await google.sheets({version: "v4"});
    const savedSignups = [];
    for (const signupToSave of signup.items) {
        const response = await gsheets.spreadsheets.values.get({
            spreadsheetId: signup.spreadSheetId,
            range: `'${signup.sheetTitle}'!${signupToSave.itemIndex}:${signupToSave.itemIndex}`
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
                    spreadsheetId: signup.spreadSheetId,
                    range: signup.sheetTitle,
                    requestBody: {
                        majorDimension: "ROWS",
                        values: [newSignupRow]
                    },
                    valueInputOption: "RAW"
                });
                savedSignups.push(newSignupRow);

                signupRowInSheet[ITEM_COUNT_INDEX] = itemCount - signupToSave.itemCount;
                if (signupRowInSheet[ITEM_COUNT_INDEX] <= 0) {
                    const gSheet = await gsheets.spreadsheets.get({
                        spreadsheetId: signup.spreadSheetId
                    });
                    const sheet = gSheet.data.sheets.find(s => s.properties.title === signup.sheetTitle);
                    await gsheets.spreadsheets.batchUpdate({
                        spreadsheetId: signup.spreadSheetId,
                        requestBody: {
                            requests: [
                                {
                                    deleteDimension: {
                                        range: {
                                            "sheetId": sheet.properties.sheetId,
                                            "dimension": "ROWS",
                                            "startIndex": signupToSave.itemIndex - 1,
                                            "endIndex": signupToSave.itemIndex
                                        }
                                    },

                                }
                            ]
                        }
                    })
                } else {
                    await gsheets.spreadsheets.values.update({
                        spreadsheetId: signup.spreadSheetId,
                        range: `'${signup.sheetTitle}'!${signupToSave.itemIndex}:${signupToSave.itemIndex}`,
                        requestBody: {
                            majorDimension: "ROWS",
                            values: [signupRowInSheet]
                        },
                        valueInputOption: "RAW"
                    })
                }
            }
        }
    }
    const detailedSheet = await getDetailedServiceSignupSheet(signup.spreadSheetId, signup.sheetTitle, user, false);
    await sendTemplateEMail(user.email, 'ServiceSignupConfirmation', {
        name: user.name,
        service: detailedSheet.title,
        description: detailedSheet.description,
        where: detailedSheet.location,
        when: detailedSheet.date,
        items: savedSignups.map((s, index) => ({
            index: index + 1,
            item: s[ITEM_INDEX],
            itemCount: s[ITEM_COUNT_INDEX],
            notes: s[NOTES_INDEX]
        }))
    });
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

const exportServiceSignups = async (user: User) => {
    const summarizedSignupSheets = await getSummarizedServiceSignupSheets(true);
    temp.track();
    const tempStream = temp.createWriteStream();
    const csvStream = stringify({
        header: true,
        columns: {
            date: 'date',
            location: 'location',
            title: 'title',
            description: 'description',
            item: 'item',
            quantity: 'quantity',
            itemCount: 'itemCount',
            notes: 'notes',
            name: 'name',
            email: 'email',
            phoneNumber: 'phoneNumber',
            signedUpOn: 'signedUpOn'
        }
    });
    csvStream.pipe(tempStream)
    for (const summarizedSignupSheet of summarizedSignupSheets) {
        const detailedSignupSheet = await getDetailedServiceSignupSheet(summarizedSignupSheet.spreadsheetId, summarizedSignupSheet.sheetTitle, user, false)
        if (!isEmpty(detailedSignupSheet) && !isEmpty(detailedSignupSheet.signees)) {
            for (const signee of detailedSignupSheet.signees) {
                csvStream.write([
                    dateFormat(summarizedSignupSheet.date, "mm/dd/yyyy"),
                    detailedSignupSheet.location,
                    detailedSignupSheet.title,
                    detailedSignupSheet.description,
                    signee.item,
                    signee.quantity,
                    signee.itemCount,
                    signee.notes,
                    signee.name,
                    signee.email,
                    signee.phoneNumber,
                    dateFormat(signee.signedUpOn, "mm/dd/yyyy hh:MM:ss.l TT Z")
                ])
            }
        }
    }
    return createReadStream(tempStream.path.toString())
};

export {
    getDetailedServiceSignupSheet,
    saveServiceSignup,
    getSummarizedServiceSignupSheets,
    exportServiceSignups,
    getUserServiceSignups
};
