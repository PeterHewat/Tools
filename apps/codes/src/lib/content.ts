/**
 * What a QR code holds, written in the forms phones act on when they scan one: a URL, mailto:,
 * tel:, SMSTO:, WIFI:, a vCard or an iCalendar event. Each throws, in words for the person,
 * when what was entered cannot make a working code.
 */

const escapeWifi = (value: string) => value.replace(/[\\;,:"]/g, "\\$&");
export function wifiContent(
  ssid: string,
  password: string,
  security: "WPA" | "WEP" | "nopass",
  hidden: boolean
): string {
  if (!ssid) throw new Error("Enter the network name (SSID).");
  if (security !== "nopass" && !password) throw new Error("Enter the network password.");
  return `WIFI:T:${security};S:${escapeWifi(ssid)};${security === "nopass" ? "" : `P:${escapeWifi(password)};`}H:${hidden};;`;
}

/** A web address; one typed without a scheme ("example.com") gets https://. */
export function linkContent(value: string): string {
  let text = value.trim();
  if (!text) throw new Error("Enter a website address.");
  if (!/^[a-z][a-z\d+.-]*:/i.test(text)) text = "https://" + text;
  try {
    const url = new URL(text);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname) throw new Error();
  } catch {
    throw new Error("Enter a website address, such as https://example.com/.");
  }
  return text;
}

export function textContent(value: string): string {
  if (!value) throw new Error("Enter the text to encode.");
  return value;
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+$/;
export function emailContent(to: string, subject: string, body: string): string {
  const address = to.trim();
  if (!EMAIL.test(address)) throw new Error("Enter an email address, such as name@example.com.");
  const query = [
    subject ? "subject=" + encodeURIComponent(subject) : "",
    body ? "body=" + encodeURIComponent(body) : "",
  ].filter(Boolean);
  return "mailto:" + address + (query.length ? "?" + query.join("&") : "");
}

/** A phone number as dialled: spaces, dots, dashes and brackets taken out. */
function phoneNumber(value: string): string {
  const number = value.replace(/[\s().-]/g, "");
  if (!/^\+?[\d*#]{3,20}$/.test(number))
    throw new Error("Enter a phone number, with its country code: +44 20 7946 0000.");
  return number;
}
export function phoneContent(number: string): string {
  return "tel:" + phoneNumber(number);
}
export function smsContent(number: string, message: string): string {
  return "SMSTO:" + phoneNumber(number) + ":" + message;
}
/** A wa.me link, which opens a chat with the number in WhatsApp, the message written. */
export function whatsappContent(number: string, message: string): string {
  const digits = phoneNumber(number).replace(/^\+/, "");
  if (!/^\d{6,15}$/.test(digits))
    throw new Error("Enter the WhatsApp number in full, with its country code: +44 7700 900000.");
  return `https://wa.me/${digits}` + (message ? "?text=" + encodeURIComponent(message) : "");
}

/** Text in a vCard or iCalendar value: backslash, comma, semicolon and line breaks escaped. */
const escapeText = (value: string) =>
  value
    .trim()
    .replace(/\r\n?/g, "\n")
    .replace(/[\\,;]/g, "\\$&")
    .replace(/\n/g, "\\n");
const lines = (entries: readonly (string | false)[]) =>
  entries.filter((line): line is string => Boolean(line)).join("\r\n");

export interface Contact {
  first: string;
  last: string;
  organization: string;
  title: string;
  mobile: string;
  phone: string;
  email: string;
  website: string;
  street: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  note: string;
}
/** A vCard 3.0, which phones offer to save as a contact. */
export function vcardContent(contact: Contact): string {
  const c = Object.fromEntries(
    Object.entries(contact).map(([name, value]) => [name, escapeText(value)])
  ) as unknown as Contact;
  const name = [c.first, c.last].filter(Boolean).join(" ") || c.organization;
  if (!name) throw new Error("Enter a name or an organization.");
  if (contact.email.trim() && !EMAIL.test(contact.email.trim()))
    throw new Error("Enter the contact's email address in full, such as name@example.com.");
  const address = [c.street, c.city, c.region, c.postcode, c.country];
  return lines([
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${c.last};${c.first};;;`,
    `FN:${name}`,
    c.organization && `ORG:${c.organization}`,
    c.title && `TITLE:${c.title}`,
    contact.mobile.trim() && `TEL;TYPE=CELL:${phoneNumber(contact.mobile)}`,
    contact.phone.trim() && `TEL;TYPE=WORK,VOICE:${phoneNumber(contact.phone)}`,
    c.email && `EMAIL:${c.email}`,
    c.website && `URL:${linkContent(contact.website)}`,
    address.some(Boolean) && `ADR;TYPE=WORK:;;${address.join(";")}`,
    c.note && `NOTE:${c.note}`,
    "END:VCARD",
  ]);
}

export interface CalendarEvent {
  title: string;
  location: string;
  description: string;
  start: Date;
  /** One hour after the start when not given. */
  end?: Date;
}
/** A moment in UTC as iCalendar writes it: 20261002T070000Z. */
const icalTime = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, "");
/** An iCalendar event, which phones offer to add to a calendar. */
export function eventContent(event: CalendarEvent): string {
  const title = escapeText(event.title);
  if (!title) throw new Error("Enter the event's title.");
  if (Number.isNaN(event.start.getTime())) throw new Error("Enter when the event starts.");
  const end =
    event.end && !Number.isNaN(event.end.getTime())
      ? event.end
      : new Date(event.start.getTime() + 3600_000);
  if (end <= event.start) throw new Error("The event must end after it starts.");
  return lines([
    "BEGIN:VEVENT",
    `SUMMARY:${title}`,
    `DTSTART:${icalTime(event.start)}`,
    `DTEND:${icalTime(end)}`,
    escapeText(event.location) && `LOCATION:${escapeText(event.location)}`,
    escapeText(event.description) && `DESCRIPTION:${escapeText(event.description)}`,
    "END:VEVENT",
  ]);
}
