import {Request, ResponseToolkit} from "@hapi/hapi";
import {google} from "googleapis";
import {authorize, sendTemplateEMail} from "./lib";

const CALENDAR_ID = "rs5nhgqdv7hsiruqnralb4t0ak@group.calendar.google.com"

export async function getBirthdayHomeBhajanSignups(req: Request, response: ResponseToolkit) {
    const gCal = google.calendar({version: "v3", auth: authorize()});
    const beginningOfYear = new Date(new Date().getFullYear(), 0, 1, 0, 0, 0, 0);
    const swamisBirthday = new Date(new Date().getFullYear(), 10, 24, 0, 0, 0, 0);
    const calendarResponse = await gCal.events.list({
        calendarId: CALENDAR_ID,
        maxResults: 365,
        timeMin: beginningOfYear.toISOString(),
        timeMax: swamisBirthday.toISOString()
    });
    return calendarResponse.data.items;
}

interface BirthdaySignup {
    name: string;
    email: string;
    phoneNumber: string;
    address: string;
    instructions: string;
    date: string;
}


export async function newBirthdayHomeBhajanSignup(req: Request, response: ResponseToolkit) {
    const gCal = google.calendar({version: "v3"});
    const signup = req.payload as BirthdaySignup;
    const startTime = new Date(signup.date);
    startTime.setHours(19);
    startTime.setMinutes(30);
    startTime.setSeconds(0);
    startTime.setMilliseconds(0);
    const endTime = new Date(startTime.toISOString());
    endTime.setHours(20);

    const description = `
    
98th Bhajans at the residence of ${signup.name} 
=================================
${signup.instructions}
=================================
Host Phone Number: ${signup.phoneNumber}
=================================
Bhajan Format: 

3 OMs
3 Gayatris
108 Names
9 Bhajans
Om Tat Sat
Sai Gayatri
Aarti
Vibhuti Prayer
=================================
Please contact Sudheesh Madhavan, 408-667-9448, for any questions.
`;

    const attendees = ["akella.sastry@gmail.com", "vignesh.ram@gmail.com", "smad4om@gmail.com", signup.email]
    const e = await gCal.events.insert({
        calendarId: CALENDAR_ID,
        sendNotifications: false,
        requestBody: {
            summary: `Residence of ${signup.name} - 98th Birthday Bhajans`,
            description,
            start: {dateTime: startTime.toISOString(), timeZone: "America/Los_Angeles"},
            end: {dateTime: endTime.toISOString(), timeZone: "America/Los_Angeles"},
        }
    })
    await sendTemplateEMail(attendees, 'BirthdayHomeBhajanSignupConfirmation', {
        ...signup,
        date: startTime,
        description
    })
    return e.data;
}

