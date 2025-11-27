// ---------- HTML pages ----------

// GET /:org/admin/assi// routes/adminAssistantDocs.js
const express = require('express');
const multer = require('multer');


const { ensureAuth, requireRole } = require('../middleware/auth');
const assistantDocsController = require('../controllers/assistantDocsController');
const router = express.Router({ mergeParams: true });


// ---- Multer config ----
const ALLOWED_MIME_TYPES = new Set([
  // PDF
  'application/pdf',

  // Word
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

  // PowerPoint
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Excel
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

  // Text-ish
  'text/plain',
  'text/markdown',
  'text/csv',
]);

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
    files: 1,                   // single file per doc
  },
  fileFilter(req, file, cb) {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(null, true);
    }
    if (req.flash) {
      req.flash('error', `Unsupported file type: ${file.originalname}`);
    }
    const err = new Error('UNSUPPORTED_FILETYPE');
    err.status = 400;
    return cb(err);
  },
});

// Guard: only org admins
router.use(ensureAuth, requireRole('ORG_ADMIN'));

// ---------- HTML pages ----------
router.get('/', assistantDocsController.listPage);
router.get('/new', assistantDocsController.newPage);
router.get('/:id/edit', assistantDocsController.editPage);

// ---------- Mutations (with optional file upload) ----------
router.post('/', upload.single('file'), assistantDocsController.create);
router.post('/:id', upload.single('file'), assistantDocsController.update);
router.post('/:id/delete', assistantDocsController.remove);

module.exports = router;
router.get('/', assistantDocsController.listPage);

// GET /:org/admin/assistant-docs/new
router.get('/new', assistantDocsController.newPage);

// GET /:org/admin/assistant-docs/:id/edit
router.get('/:id/edit', assistantDocsController.editPage);

// POST /:org/admin/assistant-docs
router.post('/', assistantDocsController.create);

// POST /:org/admin/assistant-docs/:id
router.post('/:id', assistantDocsController.update);

// POST /:org/admin/assistant-docs/:id/delete
router.post('/:id/delete', assistantDocsController.remove);

module.exports = router;
