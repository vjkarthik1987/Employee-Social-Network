// /controllers/newslettersController.js
const fetch = require('node-fetch'); 
const { Types } = require('mongoose');
const Newsletter = require('../models/Newsletter');
const NewsletterEdition = require('../models/NewsletterEdition');
const NewsletterSubscription = require('../models/NewsletterSubscription');

const Post = require('../models/Post');
const { summarizeExternalArticle } = require('../services/newsletterAi');

function stripTags(html = '') {
  return String(html).replace(/<[^>]*>/g, ' ');
}


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

function canPublishNewsletter(newsletter, user) {
    if (!newsletter || !user) return false;
    const uid = String(user._id);
    if (String(newsletter.ownerId) === uid) return true;
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
        .sort({ status: -1, number: -1 })
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
      const canPublish = canPublishNewsletter(newsletter, req.user);
  
      return res.render('newsletters/show', {
        company: req.company,
        user: req.user,
        newsletter,
        editions,
        isSubscribed,
        canEdit,
        canPublish,
        csrfToken: req.csrfToken && req.csrfToken(),
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

    if (!canEditNewsletter(newsletter, req.user) &&
        String(newsletter.ownerId) !== String(req.user._id)) {
      req.flash('error', 'You are not allowed to create editions for this newsletter.');
      return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}`);
    }

    const title = (req.body.title || '').trim();
    const subtitle = (req.body.subtitle || '').trim();
    const editorNoteHtml = (req.body.editorNoteHtml || '').toString().trim();

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
      editorNoteHtml,       // 👈 new
      items: [],
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

    // Normalise items order
    edition.items = (edition.items || []).slice().sort((a, b) => {
      return (a.position || 0) - (b.position || 0);
    });

    const canEdit = canEditNewsletter(newsletter, req.user);
    const canPublish = canPublishNewsletter(newsletter, req.user);

    // For the right-side “add content” panel
    let recentPosts = [];
    if (canEdit) {
      recentPosts = await Post.find({ companyId, deletedAt: null, status: 'PUBLISHED' })
        .sort({ createdAt: -1 })
        .limit(20)
        .select('_id type richText title createdAt')
        .lean();

      recentPosts = recentPosts.map(p => {
        const baseTitle = p.title
          || stripTags(p.richText || '').trim().slice(0, 80)
          || `Post ${String(p._id).slice(-6)}`;
        return {
          _id: p._id,
          title: baseTitle,
          type: p.type,
          createdAt: p.createdAt,
        };
      });
    }

    return res.render('newsletters/edition_show', {
      company: req.company,
      user: req.user,
      newsletter,
      edition,
      canEdit,
      canPublish,
      recentPosts,
      csrfToken: req.csrfToken && req.csrfToken(),
    });
  } catch (e) { next(e); }
};

  
  
// POST /:org/newsletters/:slug/editions/:number/items/post
exports.addPostItem = async (req, res, next) => {
    try {
      const companyId = cid(req);
      const { slug, number } = req.params;
      const postId = (req.body.postId || '').trim();
      const highlight = (req.body.highlight || '').trim();
  
      const newsletter = await Newsletter.findOne({ companyId, slug });
      if (!newsletter) return res.status(404).render('errors/404');
  
      if (!canEditNewsletter(newsletter, req.user)) {
        req.flash('error', 'You are not allowed to edit this newsletter.');
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
      }
  
      if (!postId || !Types.ObjectId.isValid(postId)) {
        req.flash('error', 'Select a valid post.');
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
      }
  
      const post = await Post.findOne({ _id: postId, companyId, deletedAt: null }).lean();
      if (!post) {
        req.flash('error', 'Post not found.');
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
      }
  
      const edition = await NewsletterEdition.findOne({
        companyId,
        newsletterId: newsletter._id,
        number: Number(number),
      });
  
      if (!edition) {
        req.flash('error', 'Edition not found.');
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}`);
      }
  
      const baseTitle = post.title
        || stripTags(post.richText || '').trim().slice(0, 80)
        || `Post ${String(post._id).slice(-6)}`;
  
      const position = (edition.items?.length || 0) + 1;
  
      edition.items.push({
        kind: 'POST',
        title: baseTitle,
        position,
        postId: post._id,
        highlight,
      });
  
      edition.lastEditedBy = req.user._id;
      await edition.save();
  
      req.flash('success', 'Post added to newsletter edition.');
      return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
    } catch (e) { next(e); }
  };
  
  // POST /:org/newsletters/:slug/editions/:number/items/external
exports.addExternalItem = async (req, res, next) => {
    try {
      const companyId = cid(req);
      const { slug, number } = req.params;
      const url = (req.body.url || '').trim();
  
      const newsletter = await Newsletter.findOne({ companyId, slug });
      if (!newsletter) return res.status(404).render('errors/404');
  
      if (!canEditNewsletter(newsletter, req.user)) {
        req.flash('error', 'You are not allowed to edit this newsletter.');
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
      }
  
      if (!url) {
        req.flash('error', 'URL is required.');
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
      }
  
      const edition = await NewsletterEdition.findOne({
        companyId,
        newsletterId: newsletter._id,
        number: Number(number),
      });
  
      if (!edition) {
        req.flash('error', 'Edition not found.');
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}`);
      }

      if (edition.status === 'PUBLISHED') {
        req.flash('error', 'Cannot modify a published edition.');
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
      }
    
      // Fetch the article HTML
      let html = '';
        try {
        const resp = await fetch(url, {
            headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'text/html',
            }
        });

        if (!resp.ok) throw new Error(`Bad status: ${resp.status}`);
        html = await resp.text();

        } catch (err) {
        req.flash('error', `Could not fetch article: ${err.message}`);
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
        }

  
      // Summarize with AI (or fallback)
      let summary;
      try {
        summary = await summarizeExternalArticle(url, html);
      } catch (err) {
        req.flash('error', `AI summarization failed: ${err.message}`);
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
      }
  
      const position = (edition.items?.length || 0) + 1;
  
      edition.items.push({
        kind: 'EXTERNAL',
        title: summary.title,
        source: summary.source,
        url,
        summaryHtml: summary.summaryHtml,
        position,
      });
  
      edition.lastEditedBy = req.user._id;
      await edition.save();
  
      req.flash('success', 'External article added to edition.');
      return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
    } catch (e) { next(e); }
  };
  
// POST /:org/newsletters/:slug/editions/:number/publish
exports.publishEdition = async (req, res, next) => {
    try {
      const companyId = cid(req);
      const { slug, number } = req.params;
  
      const newsletter = await Newsletter.findOne({ companyId, slug });
      if (!newsletter) return res.status(404).render('errors/404');
  
      if (!canPublishNewsletter(newsletter, req.user)) {
        req.flash('error', 'You are not allowed to publish this newsletter.');
        return res.redirect(`/${req.params.org}/newsletters/${slug}/editions/${number}`);
      }
  
      const edition = await NewsletterEdition.findOne({
        companyId,
        newsletterId: newsletter._id,
        number: Number(number),
      });
  
      if (!edition) {
        req.flash('error', 'Edition not found.');
        return res.redirect(`/${req.params.org}/newsletters/${slug}`);
      }
  
      if (edition.status === 'PUBLISHED') {
        req.flash('info', 'This edition is already published.');
        return res.redirect(`/${req.params.org}/newsletters/${slug}/editions/${number}`);
      }

      if (edition.status === 'PUBLISHED') {
        req.flash('error', 'Cannot modify a published edition.');
        return res.redirect(`/${req.params.org}/newsletters/${newsletter.slug}/editions/${number}`);
      }
    
      edition.status = 'PUBLISHED';
      edition.publishedAt = new Date();
      edition.lastEditedBy = req.user._id;
      await edition.save();
  
      // Update newsletter lastPublishedAt (and any future metrics)
      newsletter.lastPublishedAt = edition.publishedAt;
      await newsletter.save();
  
      // TODO: you can later add:
      // - notify subscribers (in-app + email)
      // - log audit event
  
      req.flash('success', 'Edition published.');
      return res.redirect(`/${req.params.org}/newsletters/${slug}/editions/${number}`);
    } catch (e) { next(e); }
  };
  
  // POST /:org/newsletters/:slug/editions/:number/update-meta
exports.updateEditionMeta = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { slug, number } = req.params;

    const newsletter = await Newsletter.findOne({ companyId, slug });
    if (!newsletter) return res.status(404).render('errors/404');

    if (!canEditNewsletter(newsletter, req.user)) {
      req.flash('error', 'You are not allowed to edit this newsletter.');
      return res.redirect(`/${req.params.org}/newsletters/${slug}/editions/${number}`);
    }

    const edition = await NewsletterEdition.findOne({
      companyId,
      newsletterId: newsletter._id,
      number: Number(number),
    });

    if (!edition) {
      req.flash('error', 'Edition not found.');
      return res.redirect(`/${req.params.org}/newsletters/${slug}`);
    }

    edition.title = (req.body.title || '').trim() || edition.title;
    edition.subtitle = (req.body.subtitle || '').trim();
    edition.coverImageUrl = (req.body.coverImageUrl || '').trim() || null;
    edition.summaryText = (req.body.summaryText || '').trim();
    edition.editorNoteHtml = (req.body.editorNoteHtml || '').toString().trim();
    edition.lastEditedBy = req.user._id;

    await edition.save();

    req.flash('success', 'Edition details updated.');
    return res.redirect(`/${req.params.org}/newsletters/${slug}/editions/${number}`);
  } catch (e) { next(e); }
};
