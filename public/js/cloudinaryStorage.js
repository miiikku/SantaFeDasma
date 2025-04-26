// config/cloudinaryStorage.js
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('./cloudinary');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: 'officials-profile', // Change this dynamically if needed
    allowed_formats: ['jpg', 'png', 'jpeg'],
    transformation: [{ width: 600, height: 600, crop: 'limit' }],
  }),
});

module.exports = storage;
