const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const checks = [
  ["public/index.html", /<!doctype\s+html/gi, "HTML document header"],
  ["routes/auth.js", /^const express = require\(["']express["']\);/gm, "Express import"],
  ["routes/chat.js", /^const express = require\(["']express["']\);/gm, "Express import"],
  ["routes/social.js", /^const express = require\(["']express["']\);/gm, "Express import"],
  ["routes/admin.js", /^const express = require\(["']express["']\);/gm, "Express import"],
];

function repairExactDuplicateAppend(relativePath, pattern) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 2 || matches[0].index !== 0) return false;
  const firstCopy = source.slice(0, matches[1].index).trim();
  const secondCopy = source.slice(matches[1].index).trim();
  if (!firstCopy || firstCopy !== secondCopy) return false;
  fs.writeFileSync(filePath, `${firstCopy}\n`, "utf8");
  console.warn(`Repaired an exact duplicate append in ${relativePath}.`);
  return true;
}

repairExactDuplicateAppend("public/index.html", /<!doctype\s+html/gi);
for (const route of ["routes/auth.js", "routes/chat.js", "routes/social.js", "routes/admin.js"]) {
  repairExactDuplicateAppend(route, /^const express = require\(["']express["']\);/gm);
}

const failures = [];
for (const [relativePath, pattern, label] of checks) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const count = (source.match(pattern) || []).length;
  if (count !== 1) failures.push(`${relativePath}: expected one ${label}, found ${count}`);
}

if (failures.length) {
  console.error("Source integrity check failed. A deployment upload may have appended a file instead of replacing it:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Source integrity check passed.");
