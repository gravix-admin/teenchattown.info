const pool = require("../database");

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (forwarded || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

function countryName(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized) || normalized === "XX") return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(normalized) || normalized;
  } catch (_error) {
    return normalized;
  }
}

function countryFromHeaders(req) {
  return countryName(req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || req.headers["x-country-code"]);
}

function isPublicIp(ip) {
  return ip && ip !== "::1" && ip !== "127.0.0.1" && !/^10\./.test(ip) && !/^192\.168\./.test(ip) && !/^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

async function fetchCountry(ip) {
  if (!isPublicIp(ip) || typeof fetch !== "function") return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  timer.unref?.();
  try {
    const response = await fetch(`https://api.country.is/${encodeURIComponent(ip)}`, { signal: controller.signal });
    if (!response.ok) return "";
    const data = await response.json();
    return countryName(data.country);
  } catch (_error) {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function refreshUserLocation(userId, req) {
  const ip = clientIp(req);
  const headerCountry = countryFromHeaders(req);
  const decodeHeader = (value) => {
    try { return decodeURIComponent(String(value || "").replace(/\+/g, " ")); } catch (_error) { return String(value || ""); }
  };
  const city = decodeHeader(req.headers["cf-ipcity"] || req.headers["x-vercel-ip-city"]).slice(0, 120);
  const region = decodeHeader(req.headers["cf-region"] || req.headers["x-vercel-ip-country-region"]).slice(0, 120);
  const isp = String(req.headers["cf-as-organization"] || req.headers["x-isp"] || req.headers["x-vercel-ip-as-number"] || "").slice(0, 180);
  if (headerCountry) {
    await pool.query("UPDATE users SET ip_address = ?, country = ?, ip_city = ?, ip_region = ?, ip_isp = ? WHERE id = ?", [ip, headerCountry, city, region, isp, userId]);
    return;
  }
  await pool.query("UPDATE users SET ip_address = ?, ip_city = ?, ip_region = ?, ip_isp = ? WHERE id = ?", [ip, city, region, isp, userId]);
  const detected = await fetchCountry(ip);
  if (detected) await pool.query("UPDATE users SET country = ? WHERE id = ?", [detected, userId]);
}

module.exports = { clientIp, countryFromHeaders, refreshUserLocation };
