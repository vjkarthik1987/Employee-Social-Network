// /controllers/newslettersController.js
const fetch = require('node-fetch'); 
const { Types } = require('mongoose');
const Newsletter = require('../models/Newsletter');
const NewsletterEdition = require('../models/NewsletterEdition');
const NewsletterSubscription = require('../models/NewsletterSubscription');

const Post = require('../models/Post');
const User = require('../models/User');
const { summarizeExternalArticle, generateEditionFromPostsAndLinks } = require('../services/newsletterAi');
const { sendMail } = require('../services/mailer');   // 👈 NEW

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

    // 🔹 Team details (owner / editors / publishers)
    let ownerUser = null;
    let editorUsers = [];
    let publisherUsers = [];
    let teamCandidates = [];

    if (canEdit) {
      const idSet = new Set();
      if (newsletter.ownerId) idSet.add(String(newsletter.ownerId));
      (newsletter.editors || []).forEach(id => idSet.add(String(id)));
      (newsletter.publishers || []).forEach(id => idSet.add(String(id)));

      const teamUsers = idSet.size
        ? await User.find({ companyId, _id: { $in: Array.from(idSet) } })
            .select('_id fullName title email role')
            .lean()
        : [];

      const byId = new Map(teamUsers.map(u => [String(u._id), u]));

      if (newsletter.ownerId) {
        ownerUser = byId.get(String(newsletter.ownerId)) || null;
      }

      editorUsers = (newsletter.editors || [])
        .map(id => byId.get(String(id)))
        .filter(Boolean);

      publisherUsers = (newsletter.publishers || [])
        .map(id => byId.get(String(id)))
        .filter(Boolean);

      // Candidates for dropdowns (you can tune filters later)
      teamCandidates = await User.find({ companyId })
        .select('_id fullName title role')
        .sort({ fullName: 1 })
        .limit(200)
        .lean();
    }

    return res.render('newsletters/show', {
      company: req.company,
      user: req.user,
      newsletter,
      editions,
      isSubscribed,
      canEdit,
      canPublish,
      ownerUser,
      editorUsers,
      publisherUsers,
      teamCandidates,
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

    if (!edition.items || edition.items.length === 0) {
      req.flash('error', 'Add at least one item before publishing.');
      return res.redirect(`/${req.params.org}/newsletters/${slug}/editions/${number}`);
    }

    // 🔒 24-hour guard: prevent 2 editions of THIS newsletter in 24h
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (newsletter.lastPublishedAt && newsletter.lastPublishedAt > cutoff) {
      req.flash('error', 'This newsletter already had an edition in the last 24 hours.');
      return res.redirect(`/${req.params.org}/newsletters/${slug}/editions/${number}`);
    }

    edition.status = 'PUBLISHED';
    edition.publishedAt = now;
    edition.lastEditedBy = req.user._id;
    await edition.save();

    newsletter.lastPublishedAt = edition.publishedAt;
    await newsletter.save();

    // -------- Notify subscribers via email (simple HTML) --------
    try {
      const subs = await NewsletterSubscription.find({
        companyId,
        newsletterId: newsletter._id,
        status: 'ACTIVE',
      })
        .populate('userId', 'email fullName')
        .lean();

      const subject = `${newsletter.name}: ${edition.title}`;
      const editionUrl = `${process.env.APP_BASE_URL}/${req.params.org}/newsletters/${slug}/editions/${edition.number}`;

      const introHtml = edition.editorNoteHtml
        || `<p>${edition.subtitle || 'New edition published.'}</p>`;

      const itemsHtml = (edition.items || [])
        .slice(0, 8)
        .map(it => {
          if (it.kind === 'EXTERNAL') {
            return `<li><strong>${it.title}</strong> (${it.source || 'external'})</li>`;
          }
          return `<li><strong>${it.title}</strong></li>`;
        })
        .join('');

      const html = `
        <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size:14px; line-height:1.5;">
          <h2 style="margin:0 0 8px;">${newsletter.name}: ${edition.title}</h2>
          ${edition.coverImageUrl ? `<p><img src="${edition.coverImageUrl}" alt="" style="max-width:100%;height:auto;border-radius:8px;"></p>` : ''}
          ${introHtml}
          ${itemsHtml ? `<ul>${itemsHtml}</ul>` : ''}
          <p><a href="${editionUrl}">View this edition in the app</a></p>
        </div>
      `;

      await Promise.allSettled(
        subs
          .filter(s => s.userId && s.userId.email)
          .map(s => sendMail({
            to: s.userId.email,
            subject,
            html,
          }))
      );
    } catch (err) {
      req.logger && req.logger.warn('[newsletter publish] email notify failed', err);
    }

    req.flash('success', 'Edition published and subscribers notified.');
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

// POST /:org/newsletters/:slug/editions/:number/generate-ai
exports.generateAiEdition = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { slug, number } = req.params;

    const newsletter = await Newsletter.findOne({ companyId, slug });
    if (!newsletter) return res.status(404).render('errors/404');

    if (!canEditNewsletter(newsletter, req.user)) {
      req.flash('error', 'You are not allowed to use AI for this newsletter.');
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

    // --- read form inputs ---
    const topic      = (req.body.topic || '').trim();
    const sourceType = (req.body.sourceType || 'MIXED').toUpperCase();
    const fromDate   = (req.body.fromDate || '').trim();
    const toDate     = (req.body.toDate || '').trim();
    const externalUrlsRaw = (req.body.externalUrls || '').trim();

    // time window filter for posts (optional)
    const createdAt = {};
    if (fromDate) createdAt.$gte = new Date(fromDate + 'T00:00:00.000Z');
    if (toDate)   createdAt.$lte = new Date(toDate   + 'T23:59:59.999Z');
    const hasWindow = Object.keys(createdAt).length > 0;

    // --- INTERNAL POSTS for AI ---
    let postsQuery = { companyId, deletedAt: null, status: 'PUBLISHED' };
    if (hasWindow) postsQuery.createdAt = createdAt;

    // You can later add group filters, tags, etc.
    let posts = [];
    if (sourceType === 'MIXED' || sourceType === 'INTERNAL') {
      posts = await Post.find(postsQuery)
        .sort({ createdAt: -1 })
        .limit(30)
        .select('_id type richText title createdAt')
        .lean();
    }

    const postsForAi = posts.map(p => {
      const baseTitle =
        p.title ||
        stripTags(p.richText || '').trim().slice(0, 80) ||
        `Post ${String(p._id).slice(-6)}`;
      const snippet = stripTags(p.richText || '').trim().slice(0, 240);
      return {
        id: String(p._id),
        title: baseTitle,
        url: `/${req.params.org}/posts/${p._id}`,   // internal link
        snippet,
      };
    });

    // Map for quickly resolving AI postId -> real ObjectId
    const postMap = new Map(posts.map(p => [String(p._id), p]));

    // --- EXTERNAL ARTICLES for AI ---
    let externalsForAi = [];
    if (sourceType === 'MIXED' || sourceType === 'EXTERNAL') {
      const urls = externalUrlsRaw
        .split('\n')
        .map(u => u.trim())
        .filter(Boolean);

      for (const url of urls) {
        try {
          // fetch full HTML
          const resp = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              'Accept': 'text/html',
            },
          });
          if (!resp.ok) throw new Error(`Bad status: ${resp.status}`);
          const html = await resp.text();

          const summary = await summarizeExternalArticle(url, html);
          const snippet = stripTags(summary.summaryHtml || '').slice(0, 240);

          externalsForAi.push({
            url,
            title: summary.title,
            source: summary.source,
            summaryHtml: summary.summaryHtml,
            snippet,
          });
        } catch (err) {
          // soft-fail per URL, keep going
          req.logger && req.logger.warn('[newsletter AI external fetch failed]', url, err);
        }
      }
    }

    // --- CALL AI TO BUILD EDITION STRUCTURE ---
    const aiResult = await generateEditionFromPostsAndLinks({
      topic,
      posts: postsForAi,
      externals: externalsForAi,
    });

    // --- normalise items for storing in edition.items ---
    const items = (aiResult.items || []).map((it, idx) => {
      if (it.kind === 'EXTERNAL') {
        return {
          kind: 'EXTERNAL',
          title: String(it.title || `External item #${idx + 1}`),
          source: String(it.source || ''),
          url: String(it.url || ''),
          summaryHtml: String(it.summaryHtml || ''),
          position: idx + 1,
        };
      }

      // default / POST item
      const idStr = it.postId ? String(it.postId) : '';
      const post = idStr ? postMap.get(idStr) : null;

      return {
        kind: 'POST',
        title: String(it.title || (post && post.title) || `Item #${idx + 1}`),
        highlight: String(it.highlight || ''),
        // 👇 NOTE: we use the real _id from Mongo, not Types.ObjectId(...)
        postId: post ? post._id : null,
        position: idx + 1,
      };
    });

    // --- update edition ---
    edition.items = items;
    if (aiResult.editorNoteHtml) {
      edition.editorNoteHtml = aiResult.editorNoteHtml;
    }
    edition.generatedByAi = true;
    edition.lastEditedBy = req.user._id;

    await edition.save();

    req.flash('success', 'AI drafted this edition. Review and tweak before publishing.');
    return res.redirect(`/${req.params.org}/newsletters/${slug}/editions/${number}`);
  } catch (e) {
    next(e);
  }
};

// POST /:org/newsletters/:slug/team
exports.updateTeam = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { slug } = req.params;

    const newsletter = await Newsletter.findOne({ companyId, slug });
    if (!newsletter) return res.status(404).render('errors/404');

    if (!canEditNewsletter(newsletter, req.user)) {
      req.flash('error', 'You are not allowed to update this newsletter team.');
      return res.redirect(`/${req.params.org}/newsletters/${slug}`);
    }

    // Normalise inputs → array of valid ObjectId strings
    function normalizeIds(val) {
      if (!val) return [];
      const arr = Array.isArray(val) ? val : [val];
      return arr
        .map(v => String(v || '').trim())
        .filter(v => Types.ObjectId.isValid(v));
    }

    const ownerIdRaw = String(req.body.ownerId || '').trim();
    const ownerId = Types.ObjectId.isValid(ownerIdRaw) ? ownerIdRaw : null;

    let editorIds = normalizeIds(req.body.editorIds);
    let publisherIds = normalizeIds(req.body.publisherIds);

    // Remove duplicates + keep owner out of the arrays
    if (ownerId) {
      editorIds = editorIds.filter(id => id !== ownerId);
      publisherIds = publisherIds.filter(id => id !== ownerId);
    }

    if (ownerId) {
      newsletter.ownerId = ownerId;
    }

    newsletter.editors = editorIds;
    newsletter.publishers = publisherIds;

    await newsletter.save();

    req.flash('success', 'Newsletter team updated.');
    return res.redirect(`/${req.params.org}/newsletters/${slug}`);
  } catch (e) { next(e); }
};

