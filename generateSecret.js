const crypto = require('crypto');

// Generate a 32-byte session secret
const sessionSecret = crypto.randomBytes(32).toString('hex');

console.log("Generated session secret: ", sessionSecret);
