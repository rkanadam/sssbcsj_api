import {google} from "googleapis";
import {authorize, isAdmin, sendTemplateEMail, User} from "./lib";
import {isEmpty} from "lodash";
import * as dateFormat from "dateformat";

interface ParsedSheet {
    spreadsheetId: string;
    spreadSheetTitle: string;
    sheetTitle: string;
    date: string;
}

interface SignupForBhajanRequest {
    spreadSheetId: string;
    sheetTitle: string;
    row: number;
    bhajanOrTFD?: string;
    scale?: string;
    notes?: string;
}

interface BhajanSignup {
    row: number;
    signupType: string;
    bhajanOrTFD: string;
    scale: string;
    notes: string;
    name: string;
    phoneNumber: string;
    email: string;
    signedUpOn: Date;
}

interface BhajanSignupSheet {
    date: string;
    location: string;
    description: string;
    signups: Array<BhajanSignup>;
    signees?: Array<BhajanSignup>;
    spreadsheetId: string;
    sheetTitle: string;
}

const SIGNUP_TYPE_INDEX = 1;
const NAME_INDEX = 2;
const BHAJAN_OR_TFD_INDEX = 3;
const SCALE_INDEX = 4;
const EMAIL_INDEX = 7;
const PHONE_NUMBER_INDEX = 8;
const NOTES_INDEX = 9;
const SIGNED_UP_ON_INDEX = 10;

const findIndex = (values: any[][], valueToSearchFor: string) => {
    const vs = valueToSearchFor.toLowerCase();
    return values.findIndex(v => (v[0] || "").toString().toLowerCase().trim().indexOf(vs) !== -1);
}


export async function getSummarizedDevotionSignupSheets(getAllSheetsForExport: boolean) {
    const spreadsheets = await google.drive({version: 'v3', auth: authorize()}).files.list({
        spaces: "drive",
        q: "mimeType='application/vnd.google-apps.spreadsheet'"
    });
    const signupSpreadsheets = (spreadsheets.data.files || [])
        .filter(f => f.name.toLowerCase().trim().replace(/[^0-9a-z]/, "").indexOf("bhajan") !== -1);
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
                            date: date.toISOString(),
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

export async function getDetailedDevotionSignupSheet(spreadSheetId, sheetTitle, user: User, listAllSignups = false): Promise<BhajanSignupSheet | null> {
    const gsheets = google.sheets({version: 'v4'});
    const spreadsheet = await gsheets.spreadsheets.values.get({
        spreadsheetId: spreadSheetId,
        range: sheetTitle
    });
    const isAnAdmin = isAdmin(user);
    const values = spreadsheet.data.values;
    const dateAt = findIndex(values, "date");
    const locationAt = findIndex(values, "location");
    const descriptionAt = findIndex(values, "description");
    const hashAt = findIndex(values, "#");
    const signups = new Array<BhajanSignup>();
    const signees = new Array<BhajanSignup>();
    values.forEach((v, index) => {
        if (index <= hashAt) {
            return null;
        }
        const name = (v[NAME_INDEX] || "").toString().trim();
        const email = (v[EMAIL_INDEX] || "").toString().trim();
        const phoneNumber = (v[PHONE_NUMBER_INDEX] || "").toString().trim();
        const signupType = (v[SIGNUP_TYPE_INDEX] || "").toString().trim();
        const bhajanOrTFD = (v[BHAJAN_OR_TFD_INDEX] || "").toString().trim();
        const scale = (v[SCALE_INDEX] || "").toString().trim();
        const signedUpOn = v[SIGNED_UP_ON_INDEX] ? new Date(v[SIGNED_UP_ON_INDEX].toString().trim()) : null;
        const notes = (v[NOTES_INDEX] || "").toString().trim();
        const signup: BhajanSignup = {
            name,
            email,
            phoneNumber,
            scale,
            signupType,
            bhajanOrTFD,
            row: index,
            notes,
            signedUpOn

        };
        if (isEmpty(name) && isEmpty(email) && isEmpty(phoneNumber)) {
            signups.push(signup);
        } else {
            if ((listAllSignups && isAnAdmin) || isAnAdmin || email === user.email) {
                signees.push(signup);
            }
        }
    })
    values[descriptionAt].shift();
    const bhajanSignupSheet: BhajanSignupSheet = {
        date: values[dateAt][1] || "",
        location: values[locationAt][1] || "",
        description: values[descriptionAt].join(" "),
        spreadsheetId: spreadSheetId,
        sheetTitle: sheetTitle,
        signups,
        signees,
    }
    return bhajanSignupSheet;
}

export async function saveDevotionSignup(request: SignupForBhajanRequest, user: User) {
    const gsheets = await google.sheets({version: "v4"});
    const response = await gsheets.spreadsheets.values.get({
        spreadsheetId: request.spreadSheetId,
        range: `'${request.sheetTitle}'!${request.row + 1}:${request.row + 1}`
    });
    const values = response.data.values;
    if (!isEmpty(values)) {
        const signupRowInSheet = values[0];
        const newSignupRow = [...signupRowInSheet];
        newSignupRow[SIGNED_UP_ON_INDEX] = dateFormat(new Date(), "ddd, mmm/dd/yyyy hh:MM:ss.l TT Z");
        newSignupRow[BHAJAN_OR_TFD_INDEX] = request.bhajanOrTFD || "";
        newSignupRow[SCALE_INDEX] = request.scale || "";
        newSignupRow[NAME_INDEX] = user.name;
        newSignupRow[EMAIL_INDEX] = user.email;
        newSignupRow[NOTES_INDEX] = request.notes || "";
        newSignupRow[PHONE_NUMBER_INDEX] = user.phoneNumber;
        await gsheets.spreadsheets.values.update({
            spreadsheetId: request.spreadSheetId,
            range: `'${request.sheetTitle}'!${request.row + 1}:${request.row + 1}`,
            requestBody: {
                majorDimension: "ROWS",
                values: [newSignupRow]
            },
            valueInputOption: "RAW"
        })
    }

    const detailedSheet = await getDetailedDevotionSignupSheet(request.spreadSheetId, request.sheetTitle, user, false);
    await sendTemplateEMail(user.email, 'DevotionSignupConfirmation', {
        name: user.name,
        description: detailedSheet.description,
        where: detailedSheet.location,
        when: detailedSheet.date,
        bhajanOrTFD: request.bhajanOrTFD,
        scale: request.scale,
        notes: request.notes
    })

    return true;
}

export async function getUserDevotionSignups(user: User) {
    const summarizedSignupSheets = await getSummarizedDevotionSignupSheets(false);
    const userSignups = new Array<BhajanSignupSheet>();
    for (const summarizedSignupSheet of summarizedSignupSheets) {
        const detailedSignupSheet = await getDetailedDevotionSignupSheet(summarizedSignupSheet.spreadsheetId, summarizedSignupSheet.sheetTitle, user, false)
        if (!isEmpty(detailedSignupSheet) && !isEmpty(detailedSignupSheet.signees)) {
            userSignups.push(detailedSignupSheet);
        }
    }
    return userSignups;
}

