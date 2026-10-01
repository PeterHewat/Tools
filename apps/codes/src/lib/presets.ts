const escapeWifi = (value: string) => value.replace(/[\\;,:\u0022]/g, "\\$&");
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
export function urlContent(value: string): string {
  const text = value.trim();
  try {
    const url = new URL(text);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error("Enter a complete http:// or https:// URL.");
  }
  return text;
}
