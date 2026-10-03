import { expect, test } from "bun:test";
import {
  emailContent,
  eventContent,
  linkContent,
  phoneContent,
  smsContent,
  textContent,
  vcardContent,
  whatsappContent,
} from "./content.js";
import type { Contact } from "./content.js";

test("links get https:// when typed without a scheme, and only web addresses pass", () => {
  expect(linkContent("example.com/a")).toBe("https://example.com/a");
  expect(linkContent(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
  expect(linkContent("http://localhost:8080")).toBe("http://localhost:8080");
  for (const bad of ["", "  ", "javascript:alert(1)", "ftp://example.com", "https://"])
    expect(() => linkContent(bad)).toThrow("website address");
  expect(textContent("a\nb")).toBe("a\nb");
  expect(() => textContent("")).toThrow();
});

test("email, call, SMS and WhatsApp in the forms phones act on", () => {
  expect(emailContent(" a@b.co ", "Hi there", "Line 1\nLine 2 & more")).toBe(
    "mailto:a@b.co?subject=Hi%20there&body=Line%201%0ALine%202%20%26%20more"
  );
  expect(emailContent("a@b.co", "", "")).toBe("mailto:a@b.co");
  expect(() => emailContent("not an address", "", "")).toThrow("email address");
  expect(phoneContent("+44 (20) 7946-0000")).toBe("tel:+442079460000");
  expect(() => phoneContent("call me")).toThrow("phone number");
  expect(smsContent("+1 555 0100", "Hi: there")).toBe("SMSTO:+15550100:Hi: there");
  expect(whatsappContent("+44 7700 900000", "Hello & bye")).toBe(
    "https://wa.me/447700900000?text=Hello%20%26%20bye"
  );
  expect(whatsappContent("447700900000", "")).toBe("https://wa.me/447700900000");
  expect(() => whatsappContent("12345", "")).toThrow("WhatsApp number");
});

const contact: Contact = {
  first: "Ada",
  last: "Lovelace",
  organization: "Analytical Engines, Ltd; London",
  title: "",
  mobile: "+44 7700 900000",
  phone: "",
  email: "ada@example.com",
  website: "example.com",
  street: "12 St James's Square",
  city: "London",
  region: "",
  postcode: "SW1Y 4JH",
  country: "UK",
  note: "First line\nSecond, with a comma",
};
test("a vCard escapes its text and leaves out what is empty", () => {
  expect(vcardContent(contact)).toBe(
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Lovelace;Ada;;;",
      "FN:Ada Lovelace",
      "ORG:Analytical Engines\\, Ltd\\; London",
      "TEL;TYPE=CELL:+447700900000",
      "EMAIL:ada@example.com",
      "URL:https://example.com",
      "ADR;TYPE=WORK:;;12 St James's Square;London;;SW1Y 4JH;UK",
      "NOTE:First line\\nSecond\\, with a comma",
      "END:VCARD",
    ].join("\r\n")
  );
  const blank = Object.fromEntries(Object.keys(contact).map((key) => [key, ""])) as unknown;
  expect(() => vcardContent(blank as Contact)).toThrow("name");
  expect(vcardContent({ ...(blank as Contact), organization: "Acme" })).toContain("FN:Acme");
  expect(() => vcardContent({ ...contact, email: "nope" })).toThrow("email");
});

test("an event in UTC, an hour long unless it says otherwise", () => {
  const start = new Date(Date.UTC(2026, 9, 2, 7, 30));
  expect(eventContent({ title: "Launch; v1", location: "Room 4", description: "", start })).toBe(
    [
      "BEGIN:VEVENT",
      "SUMMARY:Launch\\; v1",
      "DTSTART:20261002T073000Z",
      "DTEND:20261002T083000Z",
      "LOCATION:Room 4",
      "END:VEVENT",
    ].join("\r\n")
  );
  const end = new Date(Date.UTC(2026, 9, 3, 7, 30));
  expect(eventContent({ title: "x", location: "", description: "", start, end })).toContain(
    "DTEND:20261003T073000Z"
  );
  expect(() =>
    eventContent({ title: "x", location: "", description: "", start, end: start })
  ).toThrow("end after");
  expect(() => eventContent({ title: "", location: "", description: "", start })).toThrow("title");
  expect(() =>
    eventContent({ title: "x", location: "", description: "", start: new Date("") })
  ).toThrow("starts");
});
