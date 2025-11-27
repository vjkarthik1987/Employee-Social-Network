// controllers/assistantDocsController.js
const AssistantDoc = require('../models/AssistantDoc');
const audit = require('../services/auditService');
const microcache = require('../middleware/microcache');
const ragService = require('../services/assistantRagService');


function cid(req) {
  return req.companyId || req.company?._id;
}

function viewModel(doc) {
    return {
      _id: String(doc._id),
      title: doc.title,
      description: doc.description || '',
      url: doc.url,
      tags: doc.tags || [],
      visibility: doc.visibility || 'ALL',
      isActive: !!doc.isActive,
      originalName: doc.originalName || '',
      mimeType: doc.mimeType || '',
      size: doc.size || 0,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
  
// GET /:org/admin/assistant-docs
exports.listPage = async (req, res, next) => {
  try {
    const docs = await AssistantDoc.find({
      companyId: cid(req),
      deletedAt: null,
    })
      .sort({ createdAt: -1 })
      .lean();

    res.render('admin/assistant-docs/index', {
      company: req.company,
      user: req.user,
      items: docs.map(viewModel),
      csrfToken: res.locals.csrfToken,
      currentPath: req.originalUrl,
    });
  } catch (e) {
    next(e);
  }
};

// GET /:org/admin/assistant-docs/new
exports.newPage = (req, res) => {
  res.render('admin/assistant-docs/form', {
    company: req.company,
    user: req.user,
    item: null,
    csrfToken: res.locals.csrfToken,
    currentPath: req.originalUrl,
  });
};

// GET /:org/admin/assistant-docs/:id/edit
exports.editPage = async (req, res, next) => {
  try {
    const doc = await AssistantDoc.findOne({
      _id: req.params.id,
      companyId: cid(req),
      deletedAt: null,
    }).lean();

    if (!doc) return res.status(404).render('errors/404');

    res.render('admin/assistant-docs/form', {
      company: req.company,
      user: req.user,
      item: viewModel(doc),
      csrfToken: res.locals.csrfToken,
      currentPath: req.originalUrl,
    });
  } catch (e) {
    next(e);
  }
};

// POST /:org/admin/assistant-docs
exports.create = async (req, res, next) => {
    try {
      const body = req.body || {};
      const file = req.file || null;
  
      const tags = (body.tagsCSV || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
        .slice(0, 20);
  
      const title = body.title?.trim();
      const url = body.url?.trim();
  
      const hasUrl = !!url;
      const hasFile = !!file;
  
      if (!title) {
        req.flash && req.flash('error', 'Title is required.');
        return res.redirect('back');
      }
  
      if (!hasUrl && !hasFile) {
        req.flash && req.flash('error', 'Please provide either a URL or upload a file.');
        return res.redirect('back');
      }
  
      const payload = {
        companyId: cid(req),
        title,
        description: body.description?.trim(),
        url: hasUrl ? url : undefined,
        tags,
        visibility: (body.visibility || 'ALL').toUpperCase(),
        isActive: !!body.isActive,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      };
  
      if (hasFile) {
        payload.originalName = file.originalname;
        payload.mimeType = file.mimetype;
        payload.size = file.size;
        payload.buffer = file.buffer; // simple: store in Mongo for now
      }
  
      const doc = await AssistantDoc.create(payload);
      try {
        await ragService.ingestAssistantDoc(doc);
      } catch (err) {
        console.warn('[assistantDocs] Failed to ingest doc', doc._id, err.message);
      }
  
      await audit
        .record(req, {
          action: 'ASSISTANT_DOC_CREATED',
          targetType: 'assistantDoc',
          targetId: doc._id,
          metadata: { title: doc.title, url: doc.url, originalName: doc.originalName },
        })
        .catch(() => {});
  
      await microcache.bustTenant(req.company.slug);
  
      res.redirect(`/${req.params.org}/admin/assistant-docs`);
    } catch (e) {
      next(e);
    }
  };
  

// POST /:org/admin/assistant-docs/:id
exports.update = async (req, res, next) => {
    try {
      const body = req.body || {};
      const file = req.file || null;
  
      const doc = await AssistantDoc.findOne({
        _id: req.params.id,
        companyId: cid(req),
        deletedAt: null,
      });
  
      if (!doc) return res.status(404).render('errors/404');
  
      const before = {
        title: doc.title,
        url: doc.url,
        tags: doc.tags,
        originalName: doc.originalName,
      };
  
      const tags = (body.tagsCSV || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
        .slice(0, 20);
  
      const newTitle = body.title?.trim();
      const newUrl = body.url?.trim();
  
      if (!newTitle) {
        req.flash && req.flash('error', 'Title is required.');
        return res.redirect('back');
      }
  
      // Apply basic fields
      doc.title = newTitle;
      doc.description = body.description?.trim() || '';
      doc.url = newUrl || undefined;
      doc.tags = tags;
      doc.visibility = (body.visibility || doc.visibility).toUpperCase();
      doc.isActive = !!body.isActive;
      doc.updatedBy = req.user._id;
  
      // If a new file is uploaded, replace file metadata + buffer
      if (file) {
        doc.originalName = file.originalname;
        doc.mimeType = file.mimetype;
        doc.size = file.size;
        doc.buffer = file.buffer;
      }
  
      // Enforce: URL or file must exist after update
      const hasUrl = !!doc.url;
      const hasFile = !!doc.buffer;
  
      if (!hasUrl && !hasFile) {
        req.flash && req.flash('error', 'Please provide either a URL or upload a file.');
        return res.redirect('back');
      }
  
      await doc.save();
      try {
        await ragService.ingestAssistantDoc(doc);
      } catch (err) {
        console.warn('[assistantDocs] Failed to re-ingest doc', doc._id, err.message);
      }
      
  
      await audit
        .record(req, {
          action: 'ASSISTANT_DOC_UPDATED',
          targetType: 'assistantDoc',
          targetId: doc._id,
          metadata: {
            before,
            after: {
              title: doc.title,
              url: doc.url,
              tags: doc.tags,
              originalName: doc.originalName,
            },
          },
        })
        .catch(() => {});
  
      await microcache.bustTenant(req.company.slug);
  
      res.redirect(`/${req.params.org}/admin/assistant-docs`);
    } catch (e) {
      next(e);
    }
  };
  

// POST /:org/admin/assistant-docs/:id/delete
exports.remove = async (req, res, next) => {
  try {
    const doc = await AssistantDoc.findOne({
      _id: req.params.id,
      companyId: cid(req),
      deletedAt: null,
    });

    if (!doc) return res.status(404).render('errors/404');

    doc.deletedAt = new Date();
    doc.isActive = false;
    doc.updatedBy = req.user._id;
    await doc.save();

    await audit.record(req, {
      action: 'ASSISTANT_DOC_DELETED',
      targetType: 'assistantDoc',
      targetId: doc._id,
      metadata: { title: doc.title },
    }).catch(() => {});

    await microcache.bustTenant(req.company.slug);

    res.redirect(`/${req.params.org}/admin/assistant-docs`);
  } catch (e) {
    next(e);
  }
};
