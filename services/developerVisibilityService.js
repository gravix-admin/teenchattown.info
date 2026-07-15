const pool = require("../database");

const SETTING_KEY = "developer_profiles_visible";
let cachedValue = false;
let cachedAt = 0;

async function developerProfilesVisible({ force = false } = {}) {
  if (!force && Date.now() - cachedAt < 5000) return cachedValue;
  const [[row]] = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key = ?", [SETTING_KEY]);
  cachedValue = String(row?.setting_value || "0") === "1";
  cachedAt = Date.now();
  return cachedValue;
}

async function setDeveloperProfilesVisible(enabled) {
  cachedValue = Boolean(enabled);
  cachedAt = Date.now();
  await pool.query(
    "INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [SETTING_KEY, cachedValue ? "1" : "0"]
  );
  return cachedValue;
}

async function canViewDeveloperProfile(viewer, target) {
  if (target?.rank_name !== "developer") return true;
  if (Number(viewer?.id) === Number(target.id)) return true;
  return developerProfilesVisible();
}

module.exports = { developerProfilesVisible, setDeveloperProfilesVisible, canViewDeveloperProfile };
