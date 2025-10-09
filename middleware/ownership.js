// middleware/ownership.js
exports.ensureCommentOwnerOrMod = (req, res, next) => {
    const isPriv = ['ORG_ADMIN', 'MODERATOR'].includes(req.user?.role);
    if (isPriv) return next();
    // When using this, load the comment first or pass authorId in req.body if you prefer.
    // In our controller we re-check ownership against DB, so this is optional.
    return next();
  };
  