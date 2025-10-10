const multer = require('multer');
const path = require('path');

const makeLocal = () =>
  multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      },
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = ['image/jpeg', 'image/png', 'image/gif'].includes(file.mimetype);
      cb(ok ? null : new Error('Only JPG/PNG/GIF allowed'), ok);
    },
  });

const makeCloudinary = () => {
  const cloudinary = require('cloudinary').v2;
  const { CloudinaryStorage } = require('multer-storage-cloudinary');
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  const storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'engage_uploads',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif'],
      transformation: [{ width: 1600, height: 1600, crop: 'limit' }], // size guard
    },
  });
  return multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } });
};

module.exports = process.env.STORAGE_PROVIDER === 'cloudinary' ? makeCloudinary() : makeLocal();
