const nodemailer = require('nodemailer');
const MailerConfig = require('../models/MailerConfig');

let cached; // cache transporter + from headers

async function getTransport() {
    if (cached && cached.enabled) return cached;
  
    // 1️⃣ Try to load from DB (MailerConfig)
    let cfg = null;
    try {
      cfg = await MailerConfig.findOne({ kind: 'central' }).lean();
    } catch (err) {
      console.warn('[mailer] failed to query MailerConfig:', err.message);
    }
  
    if (cfg && cfg.enabled) {
      const transporter = nodemailer.createTransport({
        host: cfg.smtpHost,
        port: cfg.smtpPort,
        secure: Number(cfg.smtpPort) === 465,
        auth: { user: cfg.smtpUser, pass: cfg.smtpPass }
      });
      cached = {
        enabled: true,
        transporter,
        fromEmail: cfg.fromEmail,
        fromName: cfg.fromName || 'EngageHQ'
      };
      return cached;Of
    }
  
    // 2️⃣ Fallback to .env if DB config not found or disabled
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const fromEmail = process.env.SMTP_FROM;
    const fromName = process.env.SMTP_NAME || 'EngageHQ';
  
    if (host && user && pass && fromEmail) {
      console.log('[mailer] using .env SMTP fallback');
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
      });
      cached = {
        enabled: true,
        transporter,
        fromEmail,
        fromName
      };
      return cached;
    }
  
    // 3️⃣ If both fail, disable sending gracefully
    console.warn('[mailer] no SMTP config found (DB or .env); suppressing email');
    cached = { enabled: false };
    return cached;
}
  

async function sendMail({ to, subject, html }) {
  const t = await getTransport();
  if (!t.enabled) {
    console.warn('[mailer] central SMTP disabled; suppressing email:', { to, subject });
    return { ok: false, suppressed: true };
  }
  await t.transporter.sendMail({
    from: `"${t.fromName}" <${t.fromEmail}>`,
    to, subject, html
  });
  return { ok: true };
}

// Minimal templates (inline for MVP; you can move to EJS later)
function renderApprovalEmail({ company, post, decision, note }) {
  const brandName = company?.name || 'Your Company';
  const header = decision === 'approved' ? '✅ Approved' : '❌ Rejected';
  return `
    <div style="font-family:system-ui,Segoe UI,Arial">
      <h2>${header} — ${brandName}</h2>
      <p><strong>Post:</strong> ${post?.richText?.replace(/<[^>]*>/g,'').slice(0,120) || 'View in app'}</p>
      ${note ? `<p><strong>Moderator note:</strong> ${note}</p>` : ''}
      <p><a href="${process.env.APP_BASE_URL}/${company.slug}/p/${post._id}">Open in Engage</a></p>
      <hr/><small>You receive this because notifications are enabled for ${brandName}.</small>
    </div>`;
}

function renderMentionEmail({ company, actor, snippet, link }) {
  const brandName = company?.name || 'Your Company';
  return `
    <div style="font-family:system-ui,Segoe UI,Arial">
      <h2>🔔 You were mentioned — ${brandName}</h2>
      <p><strong>${actor?.fullName || 'Someone'}</strong> mentioned you:</p>
      <blockquote style="border-left:4px solid #ddd;padding-left:12px;color:#555">${snippet}</blockquote>
      <p><a href="${link}">Open in Engage</a></p>
      <hr/><small>You receive this because notifications are enabled for ${brandName}.</small>
    </div>`;
}

// services/mailer.js (or wherever this lives)
async function sendOrgVerificationEmail({ to, fullName, companyName, verifyUrl, trialEndsAt }) {
  if (!to) throw new Error('sendOrgVerificationEmail: "to" is required');
  if (!verifyUrl) throw new Error('sendOrgVerificationEmail: "verifyUrl" is required');

  const first = (fullName || '').trim().split(/\s+/)[0] || 'there';

  // Parse and format trial end date safely
  const t = (trialEndsAt instanceof Date) ? trialEndsAt : new Date(trialEndsAt);
  const hasValidDate = !Number.isNaN(t.valueOf());
  const dateStr = hasValidDate
    ? t.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const subject = `Verify your organization — Jaango.club`;

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial; color:#111">
      <h2 style="margin:0 0 12px">Welcome to Jaango, ${escapeHtml(first)}!</h2>
      <p style="margin:0 0 10px">You just created <strong>${escapeHtml(companyName || '')}</strong>.</p>
      <p style="margin:0 0 14px">To complete setup and activate your 30-day trial, please verify your organization:</p>
      <p style="margin:0 0 16px">
        <a href="${verifyUrl}" style="display:inline-block;background:#FFC33A;color:#111;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:700">
          Verify Organization
        </a>
      </p>
      <p style="margin:0 0 10px; color:#555">
        ${hasValidDate ? `Your free trial runs until <strong>${dateStr}</strong>.` : `Your free trial is active for 30 days from today.`}
      </p>
      <p style="margin:0 0 10px; color:#999">If you didn’t request this, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
      <small>This link expires in 24 hours.</small>
    </div>
  `;

  const text = [
    `Welcome to Jaango, ${first}!`,
    ``,
    `You just created ${companyName || ''}.`,
    ``,
    `To complete setup and activate your 30-day trial, verify your organization:`,
    verifyUrl,
    ``,
    hasValidDate ? `Your free trial runs until ${dateStr}.` : `Your free trial is active for 30 days from today.`,
    ``,
    `If you didn’t request this, you can safely ignore this email.`,
    `This link expires in 24 hours.`
  ].join('\n');

  return sendMail({ to, subject, html, text });
}

// tiny helper to avoid accidental HTML injection via names
function escapeHtml(s='') {
  return s
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}


module.exports = { sendMail, renderApprovalEmail, renderMentionEmail, sendOrgVerificationEmail  };
