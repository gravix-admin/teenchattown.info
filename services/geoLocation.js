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

async function fetchNetworkLocation(ip) {
  if (!isPublicIp(ip) || typeof fetch !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  timer.unref?.();
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,region,city,connection`, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.success) return null;
    return {
      country: String(data.country || "").slice(0, 80),
      region: String(data.region || "").slice(0, 120),
      city: String(data.city || "").slice(0, 120),
      isp: String(data.connection?.isp || data.connection?.org || "").slice(0, 180),
    };
  } catch (_error) {
    return null;
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
  await pool.query("UPDATE users SET ip_address = ?, country = COALESCE(NULLIF(?, ''), country), ip_city = COALESCE(NULLIF(?, ''), ip_city), ip_region = COALESCE(NULLIF(?, ''), ip_region), ip_isp = COALESCE(NULLIF(?, ''), ip_isp) WHERE id = ?", [ip, headerCountry, city, region, isp, userId]);
  if (headerCountry && city && region && isp) return;
  const detected = await fetchNetworkLocation(ip);
  if (detected) {
    await pool.query("UPDATE users SET country = COALESCE(NULLIF(?, ''), country), ip_city = COALESCE(NULLIF(?, ''), ip_city), ip_region = COALESCE(NULLIF(?, ''), ip_region), ip_isp = COALESCE(NULLIF(?, ''), ip_isp) WHERE id = ?", [detected.country, detected.city, detected.region, detected.isp, userId]);
    return;
  }
  if (!headerCountry) {
    const country = await fetchCountry(ip);
    if (country) await pool.query("UPDATE users SET country = ? WHERE id = ?", [country, userId]);
  }
}

module.exports = { clientIp, countryFromHeaders, refreshUserLocation };
