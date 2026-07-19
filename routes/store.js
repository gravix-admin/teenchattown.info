const express = require("express");
const pool = require("../database");
const { requireAuth, requireRandomIdentity } = require("../middleware/auth");
const wallet = require("../services/randomTalkWallet");

const router = express.Router();
const SUPPORT_PHONE_DISPLAY = "+91 86290 03302";
const SUPPORT_PHONE_E164 = "918629003302";

router.get("/products", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT product_code, name, description, product_type, amount_minor, currency,
            credits_awarded, gold_awarded, diamonds_awarded, rank_awarded, billing_type, inventory_limit
     FROM store_products WHERE active = 1 ORDER BY FIELD(product_type, 'credits', 'membership', 'limited_role'), amount_minor`
  );
  res.set("Cache-Control", "private, max-age=60");
  res.json({
    products: rows.map((row) => ({
      code: row.product_code,
      name: row.name,
      description: row.description,
      type: row.product_type,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      credits: Number(row.credits_awarded || 0),
      gold: Number(row.gold_awarded || 0),
      diamonds: Number(row.diamonds_awarded || 0),
      rank: row.rank_awarded || null,
      billingType: row.billing_type,
      inventoryLimit: row.inventory_limit,
    })),
    support: { phoneDisplay: SUPPORT_PHONE_DISPLAY, telephoneUrl: `tel:+${SUPPORT_PHONE_E164}` },
    purchasing: req.user ? "registered" : req.guest ? "registration_required" : "login_required",
  });
});

router.get("/wallet", requireRandomIdentity, async (req, res) => {
  const creditBalance = await wallet.ensureWallet(req.randomUser);
  res.set("Cache-Control", "private, no-store");
  res.json({ creditBalance, temporary: Boolean(req.randomUser.isGuest) });
});

router.post("/contact", requireAuth, async (req, res) => {
  const code = String(req.body.productCode || "");
  const [[product]] = await pool.query("SELECT product_code, name FROM store_products WHERE product_code = ? AND active = 1", [code]);
  if (!product) return res.status(404).json({ error: "This product is unavailable." });
  const message = `Hi, I am ${req.user.username} on TeenChatTown. I want to buy ${product.name} (${product.product_code}).`;
  res.set("Cache-Control", "no-store");
  return res.json({
    telephoneUrl: `tel:+${SUPPORT_PHONE_E164}`,
    whatsappUrl: `https://wa.me/${SUPPORT_PHONE_E164}?text=${encodeURIComponent(message)}`,
    phoneDisplay: SUPPORT_PHONE_DISPLAY,
    notice: "Contact support to begin the payment procedure. Credits or ranks are added only after staff verifies payment.",
  });
});

module.exports = router;
