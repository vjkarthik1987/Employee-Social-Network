// /middleware/linksLoader.js
const microcache = require('./microcache');         // you already have this
const InternalLink = require('../models/InternalLink');

module.exports = async function linksLoader(req, res, next) {
  try {
    // Only bother for HTML page requests (avoid API calls)
    const wantsHTML = (req.headers.accept || '').includes('text/html');
    if (!wantsHTML || !req.company) return next();

    const slug = req.company.slug;
    const k = `links:v1:${slug}`;
    const ttlSec = 30;

    const { value } = await microcache.getOrSet({
      k, ttlSec,
      fetcher: async () => {
        const rows = await InternalLink.find({
          companyId: req.companyId, isActive: true, deletedAt: null
        }).sort({ order: 1, title: 1 }).lean();

        return rows.map(l => ({
          _id: String(l._id),
          title: l.title,
          url: l.url,
          icon: l.icon
          // add customIconUrl later if/when you use it in the UI
        }));
      }
    });

    res.locals.internalLinks = value;
    return next();
  } catch (e) { return next(e); }
};
