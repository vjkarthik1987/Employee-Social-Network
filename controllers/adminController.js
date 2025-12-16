// controllers/adminController.js
const Company = require('../models/Company');
const AuditLog = require('../models/AuditLog');
const auditService = require('../services/auditService');

function clampInt(v, def, min, max) {
  const n = parseInt((v ?? '').toString().trim(), 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function parseBlockedWords(s) {
  if (!s) return [];
  return s
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function isHexColor(s) {
  return typeof s === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
}

exports.settingsForm = async (req, res, next) => {
  try {
    return res.render('admin/settings', { company: req.company, user: req.user });
  } catch (e) { next(e); }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const company = await Company.findById(req.companyId);
    if (!company) return res.status(404).render('errors/404');

    // Identity
    company.productName = (req.body.productName || '').trim();
    company.tagline     = (req.body.tagline || '').trim();
    company.gamification = company.gamification || {};
    company.gamification.rules = company.gamification.rules || {};

    company.gamification.enabled = !!req.body.gamificationEnabled;

    company.gamification.rules.POST_CREATED    = Number(req.body.pointsPostCreated || company.gamification.rules.POST_CREATED || 0);
    company.gamification.rules.COMMENT_CREATED = Number(req.body.pointsCommentCreated || company.gamification.rules.COMMENT_CREATED || 0);
    company.gamification.rules.REPLY_CREATED   = Number(req.body.pointsReplyCreated || company.gamification.rules.REPLY_CREATED || 0);
    company.gamification.rules.REACTION_ADDED  = Number(req.body.pointsReactionAdded || company.gamification.rules.REACTION_ADDED || 0);


    // Branding
    const primary   = (req.body.themePrimary || '').trim();
    const secondary = (req.body.themeSecondary || '').trim();
    if (isHexColor(primary))   company.branding.theme.primary   = primary;
    if (isHexColor(secondary)) company.branding.theme.secondary = secondary;

    // Policies
    const postingMode = (req.body.postingMode || '').toUpperCase();
    if (['OPEN','MODERATED'].includes(postingMode)) {
      company.policies.postingMode = postingMode;
    }
    company.policies.blockedWords = parseBlockedWords(req.body.blockedWordsCSV);
    company.policies.retentionDays = clampInt(req.body.retentionDays, company.policies.retentionDays || 730, 7, 3650);

    // Build a lightweight 'changed' map for audit
    const changed = {};
    function diff(path, oldV, newV) {
      if (String(oldV ?? '') !== String(newV ?? '')) changed[path] = { old: oldV ?? null, now: newV ?? null };
    }

    // Compare key fields (add more if you’d like)
    diff('productName', company.productName, (req.body.productName || '').trim());
    diff('tagline',     company.tagline,     (req.body.tagline || '').trim());

    const oldPrimary = company.branding?.theme?.primary;
    const oldSecondary = company.branding?.theme?.secondary;

    diff('branding.theme.primary',   oldPrimary,   primary);
    diff('branding.theme.secondary', oldSecondary, secondary);

    const oldMode = company.policies?.postingMode;
    const newMode = (req.body.postingMode || '').toUpperCase();
    diff('policies.postingMode', oldMode, newMode);

    const oldRetention = company.policies?.retentionDays;
    const newRetention = clampInt(req.body.retentionDays, company.policies.retentionDays || 730, 7, 3650);
    diff('policies.retentionDays', oldRetention, newRetention);

    // Note: blocked words can be long; just log counts + a preview
    const oldBlocked = company.policies?.blockedWords || [];
    const newBlocked = parseBlockedWords(req.body.blockedWordsCSV);
    if (oldBlocked.join(',') !== newBlocked.join(',')) {
      changed['policies.blockedWords'] = {
        oldCount: oldBlocked.length, nowCount: newBlocked.length,
        oldPreview: oldBlocked.slice(0, 5), nowPreview: newBlocked.slice(0, 5)
      };
    }

    company.branding.logoUrl = req.body.logoUrl || company.branding.logoUrl;
    company.branding.theme.primary = req.body.themePrimary || company.branding.theme.primary;
    company.branding.theme.accent  = req.body.themeAccent  || company.branding.theme.accent;
    company.branding.theme.darkModeDefault = !!req.body.darkModeDefault;

    await company.save();

    if (Object.keys(changed).length) {
      await AuditLog.create({
        companyId: req.companyId,
        actorUserId: req.user._id,
        action: 'POLICY_UPDATED',
        targetType: 'company',
        targetId: company._id,
        metadata: changed,
      });
    }

    req.flash('success', 'Settings updated ✅');
    return res.redirect(`/${req.company.slug}/admin/settings`);
  } catch (e) { next(e); }
};

exports.saveSettings = async (req, res, next) => {
  try {
    const company = await Company.findById(req.companyId);
    const before = {
      policies: { ...company.policies },
      branding: { ...company.branding },
    };

    // Branding inputs (already there in your code)
    // Branding inputs
    company.branding = company.branding || {};
    company.branding.theme = company.branding.theme || {};

    const primary   = (req.body.themePrimary   || '').trim();
    const secondary = (req.body.themeSecondary || '').trim();

    if (isHexColor(primary)) {
      company.branding.theme.primary = primary;
    }
    if (isHexColor(secondary)) {
      company.branding.theme.secondary = secondary;
    }

    company.branding.logoUrl = (req.body.logoUrl || '').trim() || company.branding.logoUrl;

    company.productName = (req.body.productName || '').trim() || company.productName;
    company.tagline     = (req.body.tagline || '').trim() || company.tagline;
    

    // Policies (existing)
    company.policies = company.policies || {};
    company.policies.postingMode = req.body.postingMode === 'MODERATED' ? 'MODERATED' : 'OPEN';
    company.policies.blockedWords = (req.body.blockedWordsCSV || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const days = Number(req.body.retentionDays || company.policies.retentionDays || 730);
    company.policies.retentionDays = Math.min(Math.max(days, 7), 3650);

    // NEW: Email notifications toggle (1.6)
    company.policies.notificationsEnabled = !!req.body.notificationsEnabled;

    await company.save();

    await auditService.record(req.user._id, 'SETTINGS_UPDATED', {
      companyId: company._id,
      before,
      after: {
        policies: company.policies,
        branding: company.branding,
      }
    });

    req.flash('success', 'Settings saved.');
    res.redirect(`/${req.params.org}/admin/settings`);
  } catch (e) { next(e); }
};