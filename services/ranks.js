const RANKS = [
  "bot",
  "user",
  "vip",
  "s-vip",
  "king",
  "queen",
  "devil",
  "angel",
  "legend",
  "premium",
  "moderator",
  "admin",
  "visor",
  "superadmin",
  "supervisor",
  "inspector",
  "manager",
  "chief",
  "developer",
];

const STAFF_RANKS = new Set([
  "moderator",
  "admin",
  "visor",
  "superadmin",
  "supervisor",
  "super visor",
  "inspector",
  "manager",
  "chief",
  "developer",
]);

const PURCHASABLE_RANKS = new Set(["s-vip", "devil", "angel", "legend"]);

function normalizeRank(rank) {
  return rank === "super visor" ? "supervisor" : String(rank || "user").toLowerCase();
}

function rankPower(rank) {
  return RANKS.indexOf(normalizeRank(rank));
}

function isStaffRank(rank) {
  return STAFF_RANKS.has(String(rank || "").toLowerCase());
}

module.exports = { RANKS, STAFF_RANKS, PURCHASABLE_RANKS, normalizeRank, rankPower, isStaffRank };
