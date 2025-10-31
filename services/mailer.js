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
      return cached;
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

module.exports = { sendMail, renderApprovalEmail, renderMentionEmail };
