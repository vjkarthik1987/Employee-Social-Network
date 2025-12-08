// /controllers/newslettersController.js
const { Types } = require('mongoose');
const Newsletter = require('../models/Newsletter');
const NewsletterEdition = require('../models/NewsletterEdition');
const NewsletterSubscription = require('../models/NewsletterSubscription');

function cid(req) {
  return req.companyId || req.company?._id;
}

function slugify(str = '') {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'newsletter';
}

function canEditNewsletter(newsletter, user) {
  if (!newsletter || !user) return false;
  const uid = String(user._id);
  if (String(newsletter.ownerId) === uid) return true;
  if ((newsletter.editors || []).some(id => String(id) === uid)) return true;
  if ((newsletter.publishers || []).some(id => String(id) === uid)) return true;
  return false;
}

exports.listNewsletters = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const newsletters = await Newsletter.find({ companyId, isActive: true })
      .sort({ createdAt: -1 })
      .lean();

    return res.render('newsletters/index', {
      company: req.company,
      user: req.user,
      newsletters,
    });
  } catch (e) { next(e); }
};

exports.showCreateForm = async (req, res) => {
  return res.render('newsletters/new', {
    company: req.company,
    user: req.user,
  });
};

exports.createNewsletter = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const name = (req.body.name || '').trim();
    if (!name) {
      req.flash('error', 'Name is required');
      return res.redirect('back');
    }

    const description = (req.body.description || '').trim();
    const frequency = (req.body.frequency || 'ADHOC').toUpperCase();
    const allowedFreq = ['DAILY', 'WEEKLY', 'MONTHLY', 'ADHOC'];
    const freq = allowedFreq.includes(frequency) ? frequency : 'ADHOC';

    let dayOfWeek = null;
    let dayOfMonth = null;

    if (freq === 'WEEKLY') {
      const d = Number(req.body.dayOfWeek);
      if (!Number.isNaN(d) && d >= 0 && d <= 6) dayOfWeek = d;
    } else if (freq === 'MONTHLY') {
      const d = Number(req.body.dayOfMonth);
      if (!Number.isNaN(d) && d >= 1 && d <= 31) dayOfMonth = d;
    }

    const slugBase = slugify(name);
    let slug = slugBase;
    let i = 1;
    // ensure uniqueness per company
    // eslint-disable-next-line no-constant-condition
    while (await Newsletter.findOne({ companyId, slug })) {
      slug = `${slugBase}-${++i}`;
    }

    const newsletter = await Newsletter.create({
      companyId,
      name,
      slug,
      description,
      ownerId: req.user._id,
      editors: [],
      publishers: [],
      frequency: freq,
      dayOfWeek,
      dayOfMonth,
    });

    // Auto-subscribe owner
    await NewsletterSubscription.findOneAndUpdate(
      { companyId, newsletterId: newsletter._id, userId: req.user._id },
      { $set: { status: 'ACTIVE', unsubscribedAt: null } },
      { upsert: true }
    );
    await Newsletter.updateOne(
      { _id: newsletter._id },
      { $inc: { subscribersCount: 1 } }
    ).catch(() => {});

    req.flash('success', 'Newsletter created.');
    return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}`);
  } catch (e) { next(e); }
};

exports.showNewsletter = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { slug } = req.params;

    const newsletter = await Newsletter.findOne({ companyId, slug }).lean();
    if (!newsletter) return res.status(404).render('errors/404');

    const editions = await NewsletterEdition.find({
      companyId,
      newsletterId: newsletter._id,
    })
      .sort({ status: -1, number: -1 }) // drafts first by default, then published by number
      .lean();

    let currentSub = null;
    if (req.user) {
      currentSub = await NewsletterSubscription.findOne({
        companyId,
        newsletterId: newsletter._id,
        userId: req.user._id,
      }).lean();
    }

    const isSubscribed = !!(currentSub && currentSub.status === 'ACTIVE');
    const canEdit = canEditNewsletter(newsletter, req.user);

    return res.render('newsletters/show', {
      company: req.company,
      user: req.user,
      newsletter,
      editions,
      isSubscribed,
      canEdit,
    });
  } catch (e) { next(e); }
};

exports.subscribe = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { slug } = req.params;
    const newsletter = await Newsletter.findOne({ companyId, slug });
    if (!newsletter) return res.status(404).render('errors/404');

    const existing = await NewsletterSubscription.findOne({
      companyId,
      newsletterId: newsletter._id,
      userId: req.user._id,
    });

    if (!existing || existing.status !== 'ACTIVE') {
      await NewsletterSubscription.findOneAndUpdate(
        { companyId, newsletterId: newsletter._id, userId: req.user._id },
        { $set: { status: 'ACTIVE', unsubscribedAt: null } },
        { upsert: true }
      );
      await Newsletter.updateOne(
        { _id: newsletter._id },
        { $inc: { subscribersCount: 1 } }
      ).catch(() => {});
    }

    req.flash('success', 'Subscribed.');
    return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}`);
  } catch (e) { next(e); }
};

exports.unsubscribe = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { slug } = req.params;
    const newsletter = await Newsletter.findOne({ companyId, slug });
    if (!newsletter) return res.status(404).render('errors/404');

    const sub = await NewsletterSubscription.findOne({
      companyId,
      newsletterId: newsletter._id,
      userId: req.user._id,
    });
    if (sub && sub.status === 'ACTIVE') {
      sub.status = 'UNSUBSCRIBED';
      sub.unsubscribedAt = new Date();
      await sub.save();
      await Newsletter.updateOne(
        { _id: newsletter._id },
        { $inc: { subscribersCount: -1 } }
      ).catch(() => {});
    }

    req.flash('success', 'Unsubscribed.');
    return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}`);
  } catch (e) { next(e); }
};

exports.showCreateEditionForm = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { slug } = req.params;
    const newsletter = await Newsletter.findOne({ companyId, slug }).lean();
    if (!newsletter) return res.status(404).render('errors/404');

    if (!canEditNewsletter(newsletter, req.user)) {
      req.flash('error', 'You are not allowed to create editions for this newsletter.');
      return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}`);
    }

    return res.render('newsletters/edition_edit', {
      company: req.company,
      user: req.user,
      newsletter,
      edition: null,
    });
  } catch (e) { next(e); }
};

exports.createEdition = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { slug } = req.params;
    const newsletter = await Newsletter.findOne({ companyId, slug });
    if (!newsletter) return res.status(404).render('errors/404');

    if (!canEditNewsletter(newsletter, req.user) && String(newsletter.ownerId) !== String(req.user._id)) {
      req.flash('error', 'You are not allowed to create editions for this newsletter.');
      return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}`);
    }

    const title = (req.body.title || '').trim();
    const subtitle = (req.body.subtitle || '').trim();

    // Next number
    const last = await NewsletterEdition.findOne({
      companyId,
      newsletterId: newsletter._id,
    })
      .sort({ number: -1 })
      .lean();

    const nextNumber = last ? (last.number + 1) : 1;

    const edition = await NewsletterEdition.create({
      companyId,
      newsletterId: newsletter._id,
      number: nextNumber,
      title: title || `Issue #${nextNumber}`,
      subtitle,
      status: 'DRAFT',
      generatedByAi: false,
      createdBy: req.user._id,
      lastEditedBy: req.user._id,
      items: [], // we’ll add items in next phase
    });

    req.flash('success', `Edition #${edition.number} created.`);
    return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${edition.number}`);
  } catch (e) { next(e); }
};

exports.showEdition = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { slug, number } = req.params;

    const newsletter = await Newsletter.findOne({ companyId, slug }).lean();
    if (!newsletter) return res.status(404).render('errors/404');

    const edition = await NewsletterEdition.findOne({
      companyId,
      newsletterId: newsletter._id,
      number: Number(number),
    }).lean();

    if (!edition) return res.status(404).render('errors/404');

    const canEdit = canEditNewsletter(newsletter, req.user);

    return res.render('newsletters/edition_show', {
      company: req.company,
      user: req.user,
      newsletter,
      edition,
      canEdit,
    });
  } catch (e) { next(e); }
};
