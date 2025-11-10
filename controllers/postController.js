// controllers/postController.js
const { performance } = require('perf_hooks');
const { Types } = require('mongoose');

const Post = require('../models/Post');
const User = require('../models/User');
const Group = require('../models/Group');
const Attachment = require('../models/Attachment');
const Comment = require('../models/Comment');

const { extractMentionsFromHtml, makeSnippet } = require('../utils/mentions');
const { sendMail, renderMentionEmail } = require('../services/mailer');
const audit = require('../services/auditService');
const perf = require('../services/perfService');
const microcache = require('../middleware/microcache');
const cacheStore = require('../services/cacheStore');
const etag = require('../services/etag');

function cid(req) { return req.companyId || req.company?._id; }
function isObjId(v) { return Types.ObjectId.isValid(v); }
function stripTags(html = '') { return String(html).replace(/<[^>]*>/g, ' '); }


// ---------- filter + query helpers ----------
function readFilters(req, { isGroup = false } = {}) {
  const q        = (req.query.q || '').trim();
  const type     = (req.query.type || '').toUpperCase();
  const authorId = (req.query.authorId || '').trim();
  const people   = (req.query.people || '').trim();
  const from     = (req.query.from || '').trim();
  const to       = (req.query.to || '').trim();
  const myGroups = !isGroup && String(req.query.myGroups || '') === '1';

  const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '15', 10), 5), 50);
  const skip  = (page - 1) * limit;

  return { q, type, authorId, people, from, to, myGroups, page, limit, skip };
}

async function resolvePeopleToAuthorIds({ companyId, people }) {
  if (!people) return null;
  const rx = new RegExp(people.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const users = await User
    .find({ companyId, $or: [{ fullName: rx }, { title: rx }] })
    .select('_id')
    .lean();
  return users.map(u => u._id);
}

async function attachFirstImages(posts, companyId) {
  if (!posts?.length) return posts;
  const ids = posts.map(p => p._id);
  const rows = await Attachment.aggregate([
    { $match: { companyId, targetType: 'post', targetId: { $in: ids } } },
    { $group: { _id: '$targetId', url: { $first: '$storageUrl' } } },
  ]);
  const map = new Map(rows.map(r => [String(r._id), r.url]));
  posts.forEach(p => (p.firstAttachmentUrl = map.get(String(p._id))));
  return posts;
}

async function attachGroupStubs(posts, companyId) {
  const groupIds = Array.from(new Set(
    posts.map(p => p.groupId).filter(id => id && Types.ObjectId.isValid(id)).map(String)
  ));
  if (!groupIds.length) return posts;
  const groups = await Group.find({ companyId, _id: { $in: groupIds } })
    .select('_id name')
    .lean();
  const byId = new Map(groups.map(g => [String(g._id), g]));
  posts.forEach(p => { if (p.groupId && Types.ObjectId.isValid(p.groupId)) p.group = byId.get(String(p.groupId)); });
  return posts;
}

function buildMatch({ companyId, scope, groupId, filters, authorIdsFromPeople }) {
  const allowed = new Set(['TEXT','IMAGE','LINK','POLL','ANNOUNCEMENT']);
  const match = { companyId, deletedAt: null, status: 'PUBLISHED' };

  if (scope === 'GROUP' && groupId) match.groupId = groupId;
  if (allowed.has(filters.type)) match.type = filters.type;

  if (filters.authorId && isObjId(filters.authorId)) {
    match.authorId = filters.authorId;
  } else if (authorIdsFromPeople) {
    match.authorId = authorIdsFromPeople.length ? { $in: authorIdsFromPeople } : { $in: [] };
  }

  if (filters.from || filters.to) {
    match.createdAt = {};
    if (filters.from) match.createdAt.$gte = new Date(filters.from + 'T00:00:00.000Z');
    if (filters.to)   match.createdAt.$lte = new Date(filters.to   + 'T23:59:59.999Z');
  }

  return match;
}

async function runFeedQuery({ req, scope, groupId = null }) {
  const companyId = cid(req);
  const filters = readFilters(req, { isGroup: scope === 'GROUP' });

  // myGroups filter for company feed
  let myGroupSet = null;
  if (scope === 'COMPANY' && filters.myGroups) {
    const rows = await Group.find({
      companyId,
      $or: [{ owners: req.user._id }, { moderators: req.user._id }, { members: req.user._id }]
    }).select('_id').lean();
    myGroupSet = new Set(rows.map(r => String(r._id)));
  }

  const authorIdsFromPeople = (!filters.authorId && filters.people)
    ? await resolvePeopleToAuthorIds({ companyId, people: filters.people })
    : null;

  const match = buildMatch({ companyId, scope, groupId, filters, authorIdsFromPeople });

  if (scope === 'COMPANY' && myGroupSet) {
    match.groupId = { $in: Array.from(myGroupSet).map(Types.ObjectId.createFromHexString) };
  }

  const t0 = performance.now();

  let items, total;
  if (filters.q) {
    try {
      const findCursor = Post.find({ ...match, $text: { $search: filters.q } }, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, createdAt: -1 });
      [items, total] = await Promise.all([
        findCursor
          .skip(filters.skip)
          .limit(filters.limit)
          .populate('authorId', 'fullName avatarUrl title')
          .lean(),
        Post.countDocuments(match),
      ]);
    } catch {
      const findCursor = Post.find({ ...match, richText: { $regex: filters.q, $options: 'i' } })
        .sort({ createdAt: -1 });
      [items, total] = await Promise.all([
        findCursor
          .skip(filters.skip)
          .limit(filters.limit)
          .populate('authorId', 'fullName avatarUrl title')
          .lean(),
        Post.countDocuments(match),
      ]);
    }
  } else {
    // Day 32: Pinned > Active Polls > Recency
    const pipeline = [
       { $match: match },
       { $addFields: {
           isActivePoll: {
             $cond: [
               { $and: [ { $eq: ['$type','POLL'] }, { $ne: ['$poll.isClosed', true] } ] },
               1, 0
             ]
           }
         }
       },
       { $sort: { isPinned: -1, isActivePoll: -1, createdAt: -1 } },
       { $skip: filters.skip },
       { $limit: filters.limit }
     ];
     const aggItems = await Post.aggregate(pipeline);
     total = await Post.countDocuments(match);
 
     // manual "populate" for authorId (minimal fields like earlier)
     const userIds = aggItems.map(p => p.authorId).filter(Boolean);
     const users = await User.find({ _id: { $in: userIds } }, 'fullName avatarUrl title').lean();
     const usersMap = new Map(users.map(u => [String(u._id), u]));
     items = aggItems.map(p => {
       if (p.authorId) p.authorId = usersMap.get(String(p.authorId)) || p.authorId;
       return p;
     });
  }

  const [withImg, withGroup] = await Promise.all([
    attachFirstImages(items, companyId),
    attachGroupStubs(items, companyId),
  ]);

  if (filters.q) {
    withGroup.forEach(p => {
      const text = stripTags(p.richText || '');
      const i = text.toLowerCase().indexOf(filters.q.toLowerCase());
      if (i >= 0) {
        const start = Math.max(0, i - 50);
        const end = Math.min(text.length, i + filters.q.length + 80);
        p._qExcerpt = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
      }
    });
  }

  const t1 = performance.now();
  perf.record({
    companyId,
    route: scope === 'COMPANY' ? 'feed.company' : 'feed.group',
    durationMs: t1 - t0,
    count: items.length,
    page: filters.page,
    limit: filters.limit,
  });

  const totalPages = Math.max(Math.ceil(total / filters.limit), 1);
  return { posts: withGroup, total, totalPages, ...filters };
}

// ---------- controllers ----------

// GET /:org/feed
exports.companyFeed = async (req, res, next) => {
  try {
    const filters = readFilters(req, { isGroup: false });
    const key = `feed:v1:${req.company.slug}:${cacheStore.hash(filters)}`;
    const ttl = microcache.computeTTL(req.path);   // dynamic TTL

    const { value } = await microcache.getOrSet({
      k: key, ttlSec: ttl,
      fetcher: async () => {
        const data = await runFeedQuery({ req, scope: 'COMPANY' });
        return {
          posts: data.posts,
          total: data.total, totalPages: data.totalPages,
          page: data.page, limit: data.limit,
          filters: { q: data.q, type: data.type, authorId: data.authorId, people: data.people, from: data.from, to: data.to, myGroups: data.myGroups }
        };
      }
    });

    // Pre-warm page 2 (non-blocking) when viewing page 1
    if (Number(value.page) === 1 && value.totalPages > 1) {
      const nextFilters = { ...filters, page: 2 };
      const nextKey = `feed:v1:${req.company.slug}:${cacheStore.hash(nextFilters)}`;
      const nextTtl = microcache.computeTTL(req.path);
      setImmediate(() => {
        microcache.getOrSet({
          k: nextKey, ttlSec: nextTtl,
          fetcher: async () => {
            const data = await runFeedQuery({
              req: { ...req, query: { ...req.query, page: '2' } },
              scope: 'COMPANY'
            });
            return {
              posts: data.posts,
              total: data.total, totalPages: data.totalPages,
              page: data.page, limit: data.limit,
              filters: { q: data.q, type: data.type, authorId: data.authorId, people: data.people, from: data.from, to: data.to, myGroups: data.myGroups }
            };
          }
        }).catch(() => {});
      });
    }

    // ETag for company feed (304 if unchanged)
    if (etag.setAndCheck(req, res, {
      posts: value.posts.map(p => String(p._id)),
      total: value.total, page: value.page, totalPages: value.totalPages,
      filters: value.filters
    })) return res.status(304).end();

    return res.render('feed/index', {
      company: req.company, user: req.user,
      posts: value.posts, total: value.total, totalPages: value.totalPages,
      page: value.page, limit: value.limit, filters: value.filters,
      searchAction: `/${req.params.org}/feed`, recentSearches: [],csrfToken: req.csrfToken && req.csrfToken(),
    });
  } catch (e) { next(e); }
};

// GET /:org/g/:groupId
exports.groupFeed = async (req, res, next) => {
  try {
    const groupId = req.params.groupId;
    if (!isObjId(groupId)) return res.status(404).render('errors/404');
    const group = await Group.findOne({ _id: groupId, companyId: cid(req) }).lean();
    if (!group) return res.status(404).render('errors/404');

    const filters = readFilters(req, { isGroup: true });
    const key = `groupfeed:v1:${req.company.slug}:${groupId}:${cacheStore.hash(filters)}`;
    const ttl = microcache.computeTTL(req.path);

    const { value } = await microcache.getOrSet({
      k: key, ttlSec: ttl,
      fetcher: async () => {
        const data = await runFeedQuery({ req, scope: 'GROUP', groupId });
        return {
          group,
          posts: data.posts,
          total: data.total, totalPages: data.totalPages,
          page: data.page, limit: data.limit,
          filters: { q: data.q, type: data.type, authorId: data.authorId, people: data.people, from: data.from, to: data.to, myGroups: false }
        };
      }
    });

    // Pre-warm page 2 for group feed (non-blocking)
    if (Number(value.page) === 1 && value.totalPages > 1) {
      const nextFilters = { ...filters, page: 2 };
      const nextKey = `groupfeed:v1:${req.company.slug}:${groupId}:${cacheStore.hash(nextFilters)}`;
      const nextTtl = microcache.computeTTL(req.path);
      setImmediate(() => {
        microcache.getOrSet({
          k: nextKey, ttlSec: nextTtl,
          fetcher: async () => {
            const data = await runFeedQuery({
              req: { ...req, query: { ...req.query, page: '2' } },
              scope: 'GROUP', groupId
            });
            return {
              group,
              posts: data.posts,
              total: data.total, totalPages: data.totalPages,
              page: data.page, limit: data.limit,
              filters: { q: data.q, type: data.type, authorId: data.authorId, people: data.people, from: data.from, to: data.to, myGroups: false }
            };
          }
        }).catch(() => {});
      });
    }

    // ETag for group feed (304 if unchanged)
    if (etag.setAndCheck(req, res, {
      g: String(group._id),
      posts: value.posts.map(p => String(p._id)),
      total: value.total, page: value.page, totalPages: value.totalPages,
      filters: value.filters
    })) return res.status(304).end();

    return res.render('feed/index', {
      company: req.company, user: req.user, group: value.group,
      posts: value.posts, total: value.total, totalPages: value.totalPages,
      page: value.page, limit: value.limit, filters: value.filters,
      searchAction: `/${req.params.org}/g/${groupId}`, recentSearches: [],csrfToken: req.csrfToken && req.csrfToken(),
    });
  } catch (e) { next(e); }
};


// POST /:org/posts
// fields: content, type (TEXT|LINK|IMAGE), image (multer), groupId?, imageAlt?
exports.create = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const mode = (req.company?.policies?.postingMode || 'OPEN').toUpperCase();
    const status = mode === 'MODERATED' ? 'QUEUED' : 'PUBLISHED';

    const type = (req.body.type || 'TEXT').toUpperCase();
    const groupId = req.body.groupId && isObjId(req.body.groupId) ? req.body.groupId : null;
    const richText = (req.body.content || '').toString().slice(0, 10000);
    const isAnnouncement = type === 'ANNOUNCEMENT';
    const isPoll = type === 'POLL';
    const canPin = ['MODERATOR','ORG_ADMIN'].includes(req.user.role);
    const wantPinned = String(req.body.isPinned) === 'true' || req.body.isPinned === '1';

  // --- normalize poll payload BEFORE create ---
    let pollDoc = undefined;
    if (isPoll) {
      const raw = req.body.poll || {};
      // questions may be Array or {"0":{...},"1":{...}}
      let questions = raw.questions;
      if (questions && !Array.isArray(questions) && typeof questions === 'object') {
        questions = Object.values(questions);
      }
      if (!Array.isArray(questions)) questions = [];
      if (questions.length < 1 || questions.length > 10) {
        throw new Error('POLL_QUESTION_COUNT');
      }
      const normQs = questions.map((q, qi) => {
        // options may be Array or object
        let opts = q?.options;
        if (opts && !Array.isArray(opts) && typeof opts === 'object') {
          opts = Object.values(opts);
        }
        if (!Array.isArray(opts)) opts = [];
        if (opts.length < 2 || opts.length > 10) {
          throw new Error('POLL_OPTION_COUNT');
        }
        const qid = String(q?.qid || (qi + 1).toString(36));
        const normOpts = opts.map((o, oi) => {
          // support both {label:"..."} and "..."
          const label = (typeof o === 'object' ? String(o.label || '') : String(o || '')).trim();
          const oid = String((typeof o === 'object' ? (o.oid || (oi + 1).toString(36)) : (oi + 1).toString(36)));
          return { oid, label, votesCount: 0 };
        });
        return {
          qid,
          text: String(q?.text || '').trim(),
          options: normOpts,
          multiSelect: !!q?.multiSelect
        };
      });
      pollDoc = {
        title: String(raw.title || '').trim(),
        questions: normQs,
        totalParticipants: 0,
        voterIds: [],
        isClosed: false,
        closesAt: raw.closesAt ? new Date(raw.closesAt) : null
      };
    }


    const post = await Post.create({
      companyId,
      authorId: req.user._id,
      groupId,
      type,
      richText,
      status,
      isPinned: isAnnouncement ? !!(canPin && wantPinned) : false,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
      poll: pollDoc
    });
    // Multi-image support
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length) {
      // Force type=IMAGE if attachments exist
      if (post.type !== 'IMAGE') {
        post.type = 'IMAGE';
        await post.save();
      }

      const rows = files.map(f => ({
        companyId,
        ownerUserId: req.user._id,
        targetType: 'post',
        targetId: post._id,
        storageUrl: (f.path && f.path.startsWith('http')) ? f.path : (f.location || f.secure_url || `/uploads/${f.filename}`),
        mimeType: f.mimetype || null,
        sizeBytes: f.size || null,
      }));

      if (rows.length) {
        await Attachment.insertMany(rows);
        await Post.updateOne({ _id: post._id }, { $inc: { attachmentsCount: rows.length } });
      }
    }

    audit.record({
      companyId,
      actorUserId: req.user._id,
      action: 'POST_CREATED',
      targetType: 'post',
      targetId: post._id,
      metadata: { type, status, hasAttachment: !!req.file }
    }).catch(()=>{});

    // Invalidate cached feeds
    await microcache.bustTenant(req.company.slug);
    if (post.groupId) await microcache.bustGroup(req.company.slug, post.groupId);

    // --- send @mention emails (only if tenant allows) ---
    try {
      const company = req.company;
      if (company?.policies?.notificationsEnabled) {
        const { handles, emails } = extractMentionsFromHtml(post.richText);
        if (handles.length || emails.length) {
          const usersByHandle = handles.length
            ? await User.find({ companyId, handle: { $in: handles } }).lean()
            : [];
          const usersByEmail = emails.length
            ? await User.find({ companyId, email: { $in: emails } }).lean()
            : [];

          const targets = [...usersByHandle, ...usersByEmail]
            .filter(u => String(u._id) !== String(req.user._id))   // avoid emailing self
            .filter(u => !!u.email);

          if (targets.length) {
            const snippet = makeSnippet(post.richText);
            const link = `${process.env.APP_BASE_URL}/${company.slug}/p/${post._id}`;
            const html = renderMentionEmail({ company, actor: req.user, snippet, link });

            await Promise.allSettled(
              targets.map(u => sendMail({ to: u.email, subject: `You were mentioned on ${company.name}`, html }))
            );
          }
        }
      }
    } catch (e) {
      req.logger && req.logger.warn('[post mention mail] failed', e);
    }


    req.flash('success', status === 'PUBLISHED' ? 'Posted.' : 'Submitted for review.');
    return res.redirect(`/${req.params.org}/feed`);
  } catch (e) { next(e); }
};


// GET /:org/posts/:postId
exports.getPost = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { postId } = req.params;
    if (!isObjId(postId)) return res.status(404).render('errors/404');

    const key = `post:v1:${req.company.slug}:${postId}`;
    const { value } = await microcache.getOrSet({
      k: key, ttlSec: 15,
      fetcher: async () => {
        const t0 = performance.now();
        let post = await Post.findOne({ _id: postId, companyId, deletedAt: null })
          .populate('authorId', 'fullName title avatarUrl')
          .populate({
            path: 'attachments',
            select: 'storageUrl mimeType createdAt',
            options: { sort: { createdAt: 1 } }
          })
          .lean();
        if (!post) return { notFound: true };

        const [att, grp] = await Promise.all([
          Attachment.find({ companyId, targetType: 'post', targetId: post._id })
            .select('storageUrl').sort({ createdAt: 1 }).limit(1).lean(),
          post.groupId ? Group.findOne({ _id: post.groupId, companyId }).select('_id name').lean() : null
        ]);
        if (att && att[0]) post.firstAttachmentUrl = att[0].storageUrl;
        if (grp) post.group = grp;

        const t1 = performance.now();
        perf.record({ companyId, route: 'post.show', durationMs: t1 - t0, count: 1 });
        return { post };
      }
    });

    if (value?.notFound) return res.status(404).render('errors/404');

    // Load comments (visible only)
    const comments = await Comment.find({ postId: value.post._id, status: { $ne: 'deleted' } })
      .sort({ createdAt: 1 })
      .populate('authorId', 'fullName avatarUrl title')
      .lean();

    return res.render('posts/show', {
      company: req.company,
      user: req.user,
      post: value.post,
      comments,
      viewed: true,
    });
  } catch (e) { next(e); }
};

// POST /:org/posts/:postId/delete  (soft delete)
exports.destroy = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { postId } = req.params;
    if (!isObjId(postId)) { req.flash('error', 'Invalid id'); return res.redirect('back'); }

    const post = await Post.findOne({ _id: postId, companyId });
    if (!post) { req.flash('error', 'Not found'); return res.redirect('back'); }

    const isAuthor = String(post.authorId) === String(req.user._id);
    const isPriv = ['MODERATOR','ORG_ADMIN'].includes(req.user.role);
    if (!(isAuthor || isPriv)) { req.flash('error', 'Forbidden'); return res.redirect('back'); }

    post.deletedAt = new Date();
    post.deletedBy = req.user._id;
    await post.save();

    audit.record({
      companyId,
      actorUserId: req.user._id,
      action: 'POST_DELETED',
      targetType: 'post',
      targetId: post._id,
    }).catch(()=>{});

    // Bust caches
    await microcache.bustTenant(req.company.slug);
    if (post.groupId) await microcache.bustGroup(req.company.slug, post.groupId);
    await microcache.bustPost(req.company.slug, post._id);

    req.flash('success', 'Post deleted.');
    return res.redirect(`/${req.params.org}/feed`);
  } catch (e) { next(e); }
};
