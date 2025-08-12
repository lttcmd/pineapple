import jwt from "jsonwebtoken";
import crypto from "crypto";
import { config } from "../config/env.js";
// import twilio from "twilio"; // Uncomment + configure if you want real SMS

// In-memory OTP store for dev (phone -> { code, expires })
const otpStore = new Map();

/**
 * Send a 6-digit OTP to a phone number.
 * In dev, we just log it to the console.
 */
export async function sendOtp(phone) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(phone, { code, expires: Date.now() + 5 * 60 * 1000 });

  // --- Real SMS (optional) ---
  // const client = twilio(config.twilio.sid, config.twilio.token);
  // await client.messages.create({
  //   from: config.twilio.from,
  //   to: phone,
  //   body: `Your code: ${code}`
  // });

  // Dev helper: log it so you can copy/paste
  console.log("DEV OTP for", phone, "=", code);
  return true;
}

/**
 * Verify the OTP and mint a JWT.
 * Returns { userId, token } on success, or null on failure.
 */
export function verifyOtp(phone, code) {
  const rec = otpStore.get(phone);
  if (!rec) return null;
  if (rec.expires < Date.now()) return null;
  if (rec.code !== code) return null;

  otpStore.delete(phone);

  // Create a stable, unique user id from the full phone string
  const userId =
    "U" + crypto.createHash("sha256").update(phone).digest("hex").slice(0, 12);

  const token = jwt.sign({ sub: userId, phone }, config.jwtSecret, {
    expiresIn: "7d"
  });

  return { userId, token };
}
