// /controllers/internalLinksController.js
const InternalLink = require('../models/InternalLink');
const audit = require('../services/auditService');
const microcache = require('../middleware/microcache');

function viewModel(l) {
  return {
    _id: String(l._id),
    title: l.title,
    url: l.url,
    icon: l.icon,
    customIconUrl: l.customIconUrl || '',
    category: l.category || '',
    order: l.order || 0,
    isActive: !!l.isActive,
    visibility: l.visibility || 'ALL',
    clicks: l.clicks || 0
  };
}

/* ---------- Admin pages ---------- */
exports.listPage = async (req, res, next) => {
  try {
    const items = await InternalLink.find({ companyId: req.companyId, deletedAt: null })
      .sort({ isActive: -1, order: 1, title: 1 }).lean();
    res.render('admin/internal-links/index', {
      company: req.company,
      user: req.user,
      items: items.map(viewModel),
      csrfToken: res.locals.csrfToken
    });
  } catch (e) { next(e); }
};

exports.newPage = (req, res) => {
  res.render('admin/internal-links/form', {
    company: req.company,
    user: req.user,
    item: null,
    csrfToken: res.locals.csrfToken
  });
};

exports.editPage = async (req, res, next) => {
  try {
    const item = await InternalLink.findOne({ _id: req.params.id, companyId: req.companyId, deletedAt: null }).lean();
    if (!item) return res.status(404).render('errors/404');
    res.render('admin/internal-links/form', {
      company: req.company,
      user: req.user,
      item: viewModel(item),
      csrfToken: res.locals.csrfToken
    });
  } catch (e) { next(e); }
};

exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const doc = await InternalLink.create({
      companyId: req.companyId,
      title: body.title?.trim(),
      url: body.url?.trim(),
      icon: (body.icon || 'POLICIES').toUpperCase(),
      customIconUrl: body.customIconUrl || null,
      category: body.category?.trim() || '',
      order: Number(body.order || 0),
      isActive: !!body.isActive,
      visibility: (body.visibility || 'ALL').toUpperCase(),
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await audit.record(req, {
      action: 'INTERNAL_LINK_CREATED',
      targetType: 'internalLink',
      targetId: doc._id,
      metadata: { title: doc.title, url: doc.url, icon: doc.icon }
    });

    await microcache.bustTenant(req.company.slug);
    res.redirect(`/${req.params.org}/admin/internal-links`);
  } catch (e) { next(e); }
};

exports.update = async (req, res, next) => {
  try {
    const body = req.body || {};
    const doc = await InternalLink.findOne({ _id: req.params.id, companyId: req.companyId, deletedAt: null });
    if (!doc) return res.status(404).render('errors/404');

    const before = { title: doc.title, url: doc.url, icon: doc.icon };
    doc.title = body.title?.trim() || doc.title;
    doc.url = body.url?.trim() || doc.url;
    doc.icon = (body.icon || doc.icon).toUpperCase();
    doc.customIconUrl = body.customIconUrl || null;
    doc.category = body.category?.trim() || '';
    doc.order = Number(body.order ?? doc.order);
    doc.isActive = !!body.isActive;
    doc.visibility = (body.visibility || doc.visibility).toUpperCase();
    doc.updatedBy = req.user._id;
    await doc.save();

    await audit.record(req, {
      action: 'INTERNAL_LINK_UPDATED',
      targetType: 'internalLink',
      targetId: doc._id,
      metadata: { before, after: { title: doc.title, url: doc.url, icon: doc.icon } }
    });

    await microcache.bustTenant(req.company.slug);
    res.redirect(`/${req.params.org}/admin/internal-links`);
  } catch (e) { next(e); }
};

exports.remove = async (req, res, next) => {
  try {
    const doc = await InternalLink.findOne({ _id: req.params.id, companyId: req.companyId, deletedAt: null });
    if (!doc) return res.status(404).render('errors/404');

    doc.deletedAt = new Date();
    doc.isActive = false;
    doc.updatedBy = req.user._id;
    await doc.save();

    await audit.record(req, {
      action: 'INTERNAL_LINK_DELETED',
      targetType: 'internalLink',
      targetId: doc._id,
      metadata: { title: doc.title }
    });

    await microcache.bustTenant(req.company.slug);
    res.redirect(`/${req.params.org}/admin/internal-links`);
  } catch (e) { next(e); }
};

exports.reorder = async (req, res, next) => {
  try {
    const order = Array.isArray(req.body.ids) ? req.body.ids : [];
    await Promise.all(order.map((id, idx) =>
      InternalLink.updateOne({ _id: id, companyId: req.companyId, deletedAt: null }, { $set: { order: idx } })
    ));
    await microcache.bustTenant(req.company.slug);
    res.json({ ok: true });
  } catch (e) { next(e); }
};

/* ---------- Public (sidebar) ---------- */
exports.listPublic = async (req, res, next) => {
  try {
    const slug = req.company.slug;
    const k = `links:v1:${slug}`;
    const ttl = 30; // seconds
    const { value } = await microcache.getOrSet({
      k, ttlSec: ttl,
      fetcher: async () => {
        const rows = await InternalLink.find({
          companyId: req.companyId, isActive: true, deletedAt: null
        }).sort({ order: 1, title: 1 }).lean();
        return rows.map(viewModel);
      }
    });
    // optional: ETag can be added with your etag helper if you like
    res.json({ ok: true, items: value });
  } catch (e) { next(e); }
};

exports.click = async (req, res, next) => {
  try {
    await InternalLink.updateOne(
      { _id: req.params.id, companyId: req.companyId, isActive: true, deletedAt: null },
      { $inc: { clicks: 1 } }
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
};
