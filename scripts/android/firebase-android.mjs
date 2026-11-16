import fs from "node:fs";

const input = process.env.GOOGLE_SERVICES_JSON?.replace(/^\uFEFF/, "").trim() ?? "";
function parse(text) {
  try { return JSON.parse(text); } catch { return null; }
}
const config = parse(input) ?? parse(Buffer.from(input, "base64").toString("utf8"));
const client = Array.isArray(config?.client) && config.client.some(item =>
  item.client_info?.android_client_info?.package_name === "fr.kumm.app");
if (!config?.project_info || !client || /"private_key(?:_id)?"\s*:|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(JSON.stringify(config))) {
  throw new Error("Configuration Firebase cliente Android invalide");
}
fs.writeFileSync("android/app/google-services.json", JSON.stringify(config));
