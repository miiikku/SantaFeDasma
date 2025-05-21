const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const saltRounds = 10;
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config(); // Load .env file contents into process.env
const nodemailer = require('nodemailer');
const otpStorage ={};
const multer = require("multer");
const puppeteer = require('puppeteer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const LocalUpload = multer({ dest: "public/uploads" }); // Specify the uploads folder
const cors = require('cors');
const validator = require('validator'); // Optional: only if you're using the validator package
const app = express();
const PORT = 8080;
const mongoose = require('mongoose');  // If using Mongoose
const connectDB = require('./dbConn');

// Connecting to MongoDB Atlas
mongoose.set('strictQuery', false);
connectDB();

mongoose.connection.once('open', () => {
  db = mongoose.connection.db; // Initialize the db variable
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});

mongoose.connection.on('error', (err) => {
  console.error('Error connecting to MongoDB:', err);
});


const dbName = "BrgyStaFe";
let db;

const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
      user: process.env.EMAIL_USER,     // Use the email from your environment variables
      pass: process.env.EMAIL_PASSWORD  // Use the password from your environment variables
  }
});

cloudinary.config({
  cloud_name: process.env.cloud_name,
  api_key: process.env.api_key,
  api_secret: process.env.api_secret
});

// Cloudinary Officials Storage Setup
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'officials-profile',
    allowed_formats: ['jpg', 'jpeg', 'png'],
    public_id: (req, file) => `${Date.now()}-${file.originalname}`
  }
});
const CloudUpload = multer({ storage: storage });

// Cloudinary Residents Storage Setup
const ResidentPhotoStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'residents-profile', // <-- Store in this folder
    allowed_formats: ['jpg', 'png', 'jpeg'],
    transformation: [{ width: 300, height: 300, crop: 'limit' }]
  }
});

const ResidentUpload = multer({ storage: ResidentPhotoStorage });

// Create payment link using Paymongo
const createPaymongoPaymentLink = async (amount, description) => {
    try {
        const response = await axios.post('https://api.paymongo.com/v1/links', {
            data: {
                attributes: {
                    amount: amount, // amount in centavos (e.g., 100.00 PHP = 10000 centavos)
                    description: description,
                    remarks: 'Barangay Santa Fe Document Payment'
                }
            }
        }, {
            headers: {
                'Authorization': `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY).toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.data.attributes.url; // The generated payment link
    } catch (error) {
        console.error('Error creating payment link:', error.response.data);
        throw error;
    }
};

// Define allowed origins
const allowedOrigins = [
  'http://localhost:8080', // Adjust port if different
  'http://localhost:3000', // For React development server
  'https://barangaysantafedasma.com' // Replace with your actual domain when deploying
];

// CORS configuration function
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Only allow requests from the specified origins
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true // Allow cookies to be sent with requests if needed
};


/************** MIDDLEWARE BAGONG LAGAY *****************/
// Middleware to ensure user is authenticated and has 'admin' role
function ensureAdmin(req, res, next) {
  if (req.session.role === 'admin') {
    next();
  } else {
    res.status(403).send('Forbidden: Admins only');
  }
}

// Middleware to ensure user is authenticated and has 'user' role
function ensureUser(req, res, next) {
  if (req.session.role === 'user') {
    next();
  } else {
    res.status(403).send('Forbidden: Users only');
  }
}


// Use CORS middleware with the defined options
app.use(cors(corsOptions));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.set('trust proxy', 1); // Trust first proxy (needed for secure cookies behind HTTPS/proxy)

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 60 * 60 * 1000, // 1 hour
    secure: process.env.NODE_ENV === 'production', // Only send cookie over HTTPS in production
    httpOnly: true,
    sameSite: 'lax' // Prevents JavaScript access to session cookie
  },
}));

// Helper function to validate password strength
function isStrongPassword(password) {
  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return strongPasswordRegex.test(password);
}

// Serve static files from the directories
app.use(express.static(path.join(__dirname, 'WELCOME')));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'USER')));
app.use(express.static(path.join(__dirname, 'ADMIN')));

// // Connect to MongoDB
// MongoClient.connect(uri)
//   .then(client => {
//     db = client.db(dbName);
//     console.log('Connected to MongoDB');

//     // Start the server after successful connection
//     app.listen(port, () => {
//       console.log(`Server is running on http://localhost:${port}`);
//     });
//   })
//   .catch(err => {
//     console.error('Failed to connect to MongoDB', err);
//     process.exit(1);
//   });

// Set up routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'WELCOME', 'welcome.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'WELCOME', 'login.html'));
});

// ADMIN LOGIN START
// Admin login
app.post('/admin-login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const adminCollection = db.collection('admin');
    const user = await adminCollection.findOne({ username });

    if (!user) {
      return res.status(401).send('No account found');
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).send('Wrong password');
    }

    // Store role and username in session
    req.session.username = user.username;
    req.session.role = 'admin'; // Store 'admin' role in session

    // Save the session before redirecting
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).send('Internal Server Error');
      }
      res.redirect('/dashboard.html'); // Safe to redirect after save
    });

  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).send('Internal Server Error');
  }
});


app.get('/admin-details-data', ensureAdmin, async (req, res) => {
  if (!req.session.username || req.session.role !== 'admin') {
    return res.status(401).send('Unauthorized: No user logged in');
  }

  try {
    const residentCollection = db.collection('resident');
    const resident = await residentCollection.findOne({ username: req.session.username });
    if (resident) {
      res.json(resident);
    } else {
      res.status(404).send('Resident not found');
    }
  } catch (err) {
    console.error('Error fetching admin details:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/admin-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'ADMIN', 'dashboard.html'));
});

// Endpoint to get dashboard counts
app.get('/dashboard-counts', async (req, res) => {
  try {
      const residentCollection = db.collection('resident');

      const populationCount = await residentCollection.countDocuments();
      const seniorCount = await residentCollection.countDocuments({ age: { $gte: 60 } });
      const pwdCount = await residentCollection.countDocuments({ PWD_Senior: 'PWD' });

      res.json({
          population: populationCount,
          senior: seniorCount,
          pwd: pwdCount
      });
  } catch (err) {
      console.error('Error fetching dashboard counts:', err);
      res.status(500).send('Internal Server Error');
  }
});

app.get('/dashboard-data', async (req, res) => {
  try {
      const residentCollection = db.collection('resident');
      
      const population = await residentCollection.countDocuments();
      const seniors = await residentCollection.countDocuments({ 'PWD/Senior': 'Senior' });
      const pwds = await residentCollection.countDocuments({ 'PWD/Senior': 'PWD' });

      res.json({ population, seniors, pwds });
  } catch (err) {
      console.error('Error fetching dashboard data:', err);
      res.status(500).send('Internal Server Error');
  }
});

// Admin Forgot Password: Check username and send OTP
app.post('/admin-forgot-password', async (req, res) => {
  const { username } = req.body;
  const adminCollection = db.collection('admin');
  const residentCollection = db.collection('resident');

  try {
    // Check if username exists in admin collection
    const adminUser = await adminCollection.findOne({ username });
    if (!adminUser) {
      return res.status(404).send('Admin username not found.');
    }

    // Find associated email in the resident collection
    const residentData = await residentCollection.findOne({ username });
    if (!residentData || !residentData['e-mail']) {
      return res.status(404).send('No email associated with this admin account.');
    }

    const adminEmail = residentData['e-mail']; // Extract email

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000);
    otpStorage[username] = otpCode; // Store OTP temporarily

    // Email content
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmail,
      subject: 'Admin Password Reset OTP',
      text: `Your OTP for password reset is: ${otpCode}. This code expires in 10 minutes.`,
    };

    // Send email
    await transporter.sendMail(mailOptions);
    res.status(200).send('OTP sent to your registered email.');
  } catch (err) {
    console.error('Error sending OTP:', err);
    res.status(500).send('Error sending OTP. Please try again.');
  }
});

// Admin Verify OTP
app.post('/admin-verify-otp', (req, res) => {
  const { username, otp } = req.body;

  if (otpStorage[username] && otpStorage[username] == otp) {
    delete otpStorage[username]; // Remove OTP after successful verification
    res.status(200).send('OTP verified. Proceed to reset password.');
  } else {
    res.status(400).send('Invalid OTP. Please try again.');
  }
});

app.post('/admin-reset-password', async (req, res) => {
  const { username, newPassword } = req.body;
  const adminCollection = db.collection('admin');

  // Check password strength
  if (newPassword.length < 8) {
      return res.status(400).send('Password must be at least 8 characters long.');
  }

  try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const result = await adminCollection.updateOne(
          { username },
          { $set: { password: hashedPassword } }
      );

      if (result.modifiedCount > 0) {
          res.status(200).send('Password reset successfully.');
      } else {
          res.status(404).send('Error resetting admin password.');
      }
  } catch (err) {
      console.error('Error resetting admin password:', err);
      res.status(500).send('Internal Server Error');
  }
});

// ADMIN LOGIN END


// USER/RESIDENT LOGIN/LOGOUT START
// Hash password during signup
app.post('/signup', async (req, res) => {
  const { password, 'confirm-password': confirmPassword } = req.body;

  // Check password strength
  if (!isStrongPassword(password)) {
    return res.status(400).send('Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character.');
  }

  if (password !== confirmPassword) {
    return res.status(400).send('Passwords do not match');
  }
  
  const { firstname, middlename, lastname, username, email } = req.body;

  try {
    const residentsCollection = db.collection('resident');
    const userAccountsCollection = db.collection('user-account');

    // Check if resident exists by matching first name, middle name, and last name
    const resident = await residentsCollection.findOne({
      Firstname: { $regex: new RegExp(`^${firstname}$`, 'i') },
      Middlename: { $regex: new RegExp(`^${middlename}$`, 'i') },
      Lastname: { $regex: new RegExp(`^${lastname}$`, 'i') }
    });

    if (resident) {
      // Check if the username already exists in 'user-account' collection
      const existingUser = await userAccountsCollection.findOne({ username: new RegExp(`^${username}$`, 'i') });

      if (existingUser) {
        return res.status(400).send('An account with this username already exists.');
      }

      // Hash the password before saving it
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Save the user account with hashed password in the 'user-account' collection
      await userAccountsCollection.insertOne({
        firstname, middlename, lastname, username, password: hashedPassword
      });

      // Save the email to the 'resident' collection under "e-mail"
      await residentsCollection.updateOne(
        {
          Firstname: { $regex: new RegExp(`^${firstname}$`, 'i') },
          Middlename: { $regex: new RegExp(`^${middlename}$`, 'i') },
          Lastname: { $regex: new RegExp(`^${lastname}$`, 'i') }
        },
        { $set: { 'e-mail': email, 'username': username } } // Set the email under "e-mail"
      );
      
      req.session.username = username;

      return res.status(200).send('Account created successfully');
    } else {
      return res.status(404).send('No resident name found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});


// Resident login
app.post('/resident-login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const userAccountCollection = db.collection('user-account');
    const user = await userAccountCollection.findOne({ username });

    if (!user) {
      return res.status(401).send('No account found');
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).send('Wrong password');
    }

    // Store role and username in session
    req.session.userId = user._id;
    req.session.username = user.username;
    req.session.role = 'user'; // Store 'user' role in session

    // Save the session before sending success response
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).send('Internal Server Error');
      }
      res.status(200).send('Login successful');
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/offices.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'USER', 'offices.html'));
});

// Routes accessible only to regular users
app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, 'USER', 'home.html'));
});

app.get('/request-document.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'USER', 'request-document.html'));
});

app.get('/user-details', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const userAccountCollection = db.collection('user-account');
    const residentCollection = db.collection('resident');

    // Fetch user from the user-account collection
    const user = await userAccountCollection.findOne({ _id: new ObjectId(req.session.userId) });

    if (user) {
      // Use the user's full name to search in the resident collection
      const resident = await residentCollection.findOne({
        Firstname: user.firstname,
        Middlename: user.middlename,
        Lastname: user.lastname,
      });

      // Add the age if found in the resident collection
      user.age = resident ? resident.age : null;
      user.Address = resident ? resident.Address : null;
      user.yearsresiding = resident ? resident.yearsresiding : null;

      console.log("Fetched resident from resident collection:", resident);
      res.json(user);
    } else {
      res.status(404).send('User not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/user-profile.html', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'USER', 'user-profile.html'));
});

app.get('/user-profile-data', ensureUser, async (req, res) => {
  if (!req.session.userId || req.session.role !== 'user') {
    return res.status(401).send('Unauthorized');
  }

  try {
    const userAccountCollection = db.collection('user-account');
    const residentCollection = db.collection('resident');

    // Fetch the logged-in user by username stored in session
    const userAccount = await userAccountCollection.findOne({ _id: new ObjectId(req.session.userId) });

    if (!userAccount) {
      return res.status(404).send('User account not found');
    }

    // Now fetch the resident details using the username field
    const resident = await residentCollection.findOne({ username: userAccount.username });

    if (!resident) {
      return res.status(404).send('Resident not found');
    }

    // Respond with the resident data to populate the profile
    res.json(resident);
  } catch (err) {
    console.error('Error fetching user profile data:', err);
    res.status(500).send('Internal Server Error');
  }
});


app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send('Could not log out.');
    } else {
      res.redirect('/');
    }
  });
});
// USER/RESIDENT LOGIN/LOGOUT END

// USER FORGOT PASSWORD
app.post('/forgot-password', async (req, res) => {
  const { username } = req.body;
  const userAccountCollection = db.collection('user-account');
  const residentCollection = db.collection('resident');

  try {
      // 🔍 Step 1: Check if the username exists in `user-account`
      const user = await userAccountCollection.findOne({ username });
      if (!user) {
          return res.status(404).send('Username not found.');
      }

      // 🔍 Step 2: Find the email in the `resident` collection
      const resident = await residentCollection.findOne({ username });
      if (!resident || !resident['e-mail']) {  // Ensure field name matches MongoDB (check if it's 'email' or 'e-mail')
          return res.status(404).send('No email associated with this account.');
      }

      const userEmail = resident['e-mail']; // Extract the email

      // 🔹 Step 3: Generate a 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000); 
      otpStorage[username] = otp; // Store OTP temporarily

      // 🔹 Step 4: Send OTP to the user's email using Nodemailer
      const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
              user: process.env.EMAIL_USER, 
              pass: process.env.EMAIL_PASSWORD
          }
      });

      const mailOptions = {
          from: process.env.EMAIL_USER,
          to: userEmail,
          subject: 'Password Reset OTP',
          text: `Your OTP for password reset is: ${otp}. It will expire in 5 minutes.`
      };

      await transporter.sendMail(mailOptions);

      res.status(200).send('OTP has been sent to your email.');
  } catch (error) {
      console.error('Error sending OTP:', error);
      res.status(500).send('Internal Server Error');
  }
});

// 🔹 Forgot Password - Step 2: Verify OTP
app.post('/verify-otp', async (req, res) => {
  const { username, otp } = req.body;

  if (otpStorage[username] && otpStorage[username] == otp) {
      delete otpStorage[username]; // Remove OTP after verification
      res.status(200).send('OTP verified. Proceed to reset password.');
  } else {
      res.status(400).send('Invalid OTP.');
  }
});

app.post('/reset-password', async (req, res) => {
  const { username, newPassword } = req.body;
  const userAccountCollection = db.collection('user-account');

  // Check password strength
  if (newPassword.length < 8) {
      return res.status(400).send('Password must be at least 8 characters long.');
  }

  try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const result = await userAccountCollection.updateOne(
          { username },
          { $set: { password: hashedPassword } }
      );

      if (result.modifiedCount > 0) {
          res.status(200).send('Password reset successfully.');
      } else {
          res.status(404).send('Error resetting password.');
      }
  } catch (err) {
      console.error('Error resetting password:', err);
      res.status(500).send('Internal Server Error');
  }
});

/************************ USER SIDE START ************************/ 

// REQUEST-DOCUMENT-CERT.HTML
app.post('/add-request-document-cert', async (req, res) => {
  const newRequest = {
    ...req.body,
    status: 'Processing', // Set default status to 'Processing'
  };

  try {
    const requestsCollection = db.collection('request-certification');
    const result = await requestsCollection.insertOne(newRequest);
    const savedRequest = await requestsCollection.findOne({ _id: result.insertedId });
    res.status(200).send({ success: true, request: savedRequest });
  } catch (err) {
    console.error('Error adding request:', err);
    res.status(500).send({ success: false });
  }
});

// REQUEST-DOCUMENT-CLEAR.HTML
app.post('/add-request-document-clear', async (req, res) => {
  const newRequest = {
    ...req.body,
    status: 'Processing', // Set default status to 'Processing'
  };

  try {
    const requestsCollection = db.collection('request-clearance');
    const result = await requestsCollection.insertOne(newRequest);
    const savedRequest = await requestsCollection.findOne({ _id: result.insertedId });
    res.status(200).send({ success: true, request: savedRequest });
  } catch (err) {
    console.error('Error adding request:', err);
    res.status(500).send({ success: false });
  }
});

// REQUEST-DOCUMENT-INDI.HTML
app.post('/add-request-indigency', async (req, res) => {
  const newRequest = {
    ...req.body,
    status: 'Processing', // This line ensures that the status is added
  };

  try {
    const requestsCollection = db.collection('request-indigency');
    const result = await requestsCollection.insertOne(newRequest);
    const savedRequest = await requestsCollection.findOne({ _id: result.insertedId });
    res.status(200).send({ success: true, request: savedRequest });
  } catch (err) {
    console.error('Error adding request:', err);
    res.status(500).send({ success: false });
  }
});


/************************ USER SIDE END ************************/ 



/************************ ADMIN SIDE START ************************/ 

app.get('/user-accounts', async (req, res) => {
  try {
    const userAccountCollection = db.collection('user-account');
    const userAccounts = await userAccountCollection.find().toArray();
    res.json(userAccounts);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/user-accounts', async (req, res) => {
  const { firstname, middlename, lastname, username, password } = req.body;

  try {
    const residentsCollection = db.collection('resident');
    const userAccountCollection = db.collection('user-account');

    // Query to find resident by first, middle, and last name (case-insensitive)
    const query = {
      'Firstname': { $regex: new RegExp(`^${firstname}$`, 'i') },
      'Lastname': { $regex: new RegExp(`^${lastname}$`, 'i') }
    };

    if (middlename) {
      query.Middlename = { $regex: new RegExp(`^${middlename}$`, 'i') };
    }

    // Check if the resident exists
    const resident = await residentsCollection.findOne(query);

    if (!resident) {
      return res.status(404).send('Resident not found');
    }

    // Check if the username already exists in the user-account collection
    const existingUser = await userAccountCollection.findOne({ username });

    if (existingUser) {
      return res.status(400).send('Username already exists. Please choose a different username.');
    }

    // Hash the password before saving it
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Prepare the new user account object with hashed password
    const newUserAccount = {
      firstname,
      middlename,
      lastname,
      username,
      password: hashedPassword
    };

    // Insert the new user account in the user-account collection
    await userAccountCollection.insertOne(newUserAccount);

    // Update the resident collection with the username
    await residentsCollection.updateOne(query, {
      $set: { username: newUserAccount.username }
    });

    res.status(200).send('User account added successfully and resident updated with username');
  } catch (err) {
    console.error('Error adding user account:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/check-username', async (req, res) => {
    const username = req.query.username;

    try {
        const userAccountCollection = db.collection('user-account'); // or whatever collection you're using
        const user = await userAccountCollection.findOne({ username });
        
        // Return true if user exists, false otherwise
        res.json({ exists: !!user }); // Sends { exists: true } if user found, { exists: false } otherwise
    } catch (error) {
        console.error('Error checking username:', error);
        res.status(500).json({ error: 'Error checking username.' }); // Send JSON error response
    }
});

app.delete('/user-accounts/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const userAccountCollection = db.collection('user-account');
    await userAccountCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).send('User account deleted successfully');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/admin-accounts', async (req, res) => {
  const { firstname, middlename, lastname, username, password } = req.body;
  
  try {
    const residentsCollection = db.collection('resident');
    const adminAccountCollection = db.collection('admin');
    
    // Check if the resident exists (case-insensitive check)
    const resident = await residentsCollection.findOne({
      'Firstname': new RegExp(`^${firstname}$`, 'i'),
      'Lastname': new RegExp(`^${lastname}$`, 'i')
    });

    if (!resident) {
      return res.status(404).send('Resident not found');
    }

    // Check if the username already exists in the admin collection (case-insensitive)
    const existingAccount = await adminAccountCollection.findOne({
      username: { $regex: new RegExp(`^${username}$`, 'i') }
    });

    if (existingAccount) {
      return res.status(409).send('Username already exists');
    }

    // Hash the password before saving it
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    const newAdminAccount = {
      firstname,
      middlename,
      lastname,
      username,
      password: hashedPassword
    };

    // Insert new admin account if the username does not exist
    await adminAccountCollection.insertOne(newAdminAccount);

    // Update the resident collection with the username
    await residentsCollection.updateOne(
      {
        'Firstname': new RegExp(`^${firstname}$`, 'i'),
        'Lastname': new RegExp(`^${lastname}$`, 'i')
      },
      { $set: { username } }
    );

    res.status(200).send('Admin account added successfully and resident updated with username');
  } catch (err) {
    console.error('Error adding admin account:', err);
    res.status(500).send('Internal Server Error');
  }
});



// Check Duplicate for username admin
// Endpoint to check if the username already exists in the admin collection (official accounts)
app.get('/check-username-official', async (req, res) => {
  const username = req.query.username;

  try {
    const adminCollection = db.collection('admin'); // Admin collection that handles official accounts
    
    // Search for the username in the admin collection (case-insensitive)
    const user = await adminCollection.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
    
    // If user exists, return true, otherwise false
    if (user) {
      res.json({ exists: true });
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    console.error('Error checking username:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.delete('/admin-accounts/:id',  async (req, res) => {
  const id = req.params.id;
  try {
    const adminCollection = db.collection('admin');
    await adminCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).send('Admin account deleted successfully');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/admin-accounts', async (req, res) => {
  try {
    const adminCollection = db.collection('admin');
    const adminAccounts = await adminCollection.find().toArray();
    res.json(adminAccounts);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});


app.get('/residents', async (req, res) => {
  try {
      const residentCollection = db.collection('resident');
      const residents = await residentCollection.find().toArray();
      res.json(residents);
  } catch (err) {
      console.error('Error fetching residents:', err);
      res.status(500).send('Internal Server Error');
  }
});


app.get('/residents/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const residentCollection = db.collection('resident');
    const userAccountCollection = db.collection('user-account');
    const adminAccountCollection = db.collection('admin');

    // Find the resident by ID
    const resident = await residentCollection.findOne({ _id: new ObjectId(id) });

    if (resident) {
      // Check if the resident exists in the user-account collection
      const userAccount = await userAccountCollection.findOne({
        firstname: { $regex: new RegExp(`^${resident.Firstname}$`, 'i') },
        middlename: { $regex: new RegExp(`^${resident.Middlename}$`, 'i') },
        lastname: { $regex: new RegExp(`^${resident.Lastname}$`, 'i') }
      });

      // Check if the resident exists in the admin collection
      const adminAccount = await adminAccountCollection.findOne({
        firstname: { $regex: new RegExp(`^${resident.Firstname}$`, 'i') },
        middlename: { $regex: new RegExp(`^${resident.Middlename}$`, 'i') },
        lastname: { $regex: new RegExp(`^${resident.Lastname}$`, 'i') }
      });

      // Add username to the resident object if found
      let username = null;
      if (userAccount) {
        username = userAccount.username;
      } else if (adminAccount) {
        username = adminAccount.username;
      }

      // Return the resident details along with the username (if found)
      res.json({ ...resident, username });
    } else {
      res.status(404).send('Resident not found');
    }
  } catch (err) {
    console.error('Error fetching resident details:', err);
    res.status(500).send('Internal Server Error');
  }
});



app.post('/residents', ResidentUpload.single('photo'), async (req, res) => {
  try {
    const {
      firstname, middlename, lastname, birthdate, age, gender, civilstatus, pwd_senior,
      voter_status, contact_number, startDate, yearsresiding, email, blk, lot,
      street, barangay, city, province
    } = req.body;

    const address = `Blk ${blk}, Lot ${lot}, ${street}, ${barangay}, ${city}, ${province}`;
    const profilePicUrl = req.file?.path || '';

    // Organization Array
    let organization = [];
    try {
      if (req.body.Organization) {
        organization = JSON.parse(req.body.Organization);
      }
    } catch (e) {
      console.error("Failed to parse Organization:", e);
    }

    const newResident = {
      Profilepic: profilePicUrl,
      Firstname: firstname,
      Middlename: middlename,
      Lastname: lastname,
      birthdate,
      age,
      gender,
      civilstatus,
      Organization: organization,
      "Voter Status": voter_status,
      "Contact Number": contact_number,
      Address: address,
      startDate,
      yearsresiding,
      "e-mail": email
    };

    const residentCollection = db.collection('resident');
    await residentCollection.insertOne(newResident);
    res.status(200).json({ success: true, message: 'Resident added successfully' });
  } catch (err) {
    console.error('Error adding resident:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

app.put('/residents/:id', ResidentUpload.single('photo'), async (req, res) => {
  const id = req.params.id;
  const {
    firstname, middlename, lastname, birthdate, age, gender,
    civilstatus, pwd_senior, voter_status, contact_number,
    startDate, yearsresiding, email, blk, lot, street, barangay, city, province
  } = req.body;

  const fullAddress = `Blk ${blk}, Lot ${lot}, ${street}, ${barangay}, ${city}, ${province}`;

  let organization = [];
  try {
    if (req.body.Organization) {
      organization = JSON.parse(req.body.Organization);
    }
  } catch (e) {
    console.error("Failed to parse Organization:", e);
  }

  const updatedResident = {
    Firstname: firstname,
    Middlename: middlename,
    Lastname: lastname,
    birthdate,
    age,
    gender,
    civilstatus,
    Organization: organization,
    "Voter Status": voter_status,
    "Contact Number": contact_number,
    Address: fullAddress,
    startDate,
    yearsresiding,
    "e-mail": email
  };

  if (req.file) {
    updatedResident.Profilepic = req.file.path; // ✅ Use Cloudinary secure URL
  }

  try {
    const residentCollection = db.collection('resident');
    await residentCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedResident });
    res.status(200).json({ success: true, message: 'Resident updated successfully' });
  } catch (err) {
    console.error('Error updating resident:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

app.delete('/residents/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const residentCollection = db.collection('resident');
    await residentCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).send('Resident deleted successfully');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/barangay-ids', async (req, res) => {
  try {
    const barangayIdCollection = db.collection('barangay-id');
    const barangayIds = await barangayIdCollection.find().toArray();
    res.json(barangayIds);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/barangay-ids/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const barangayIdCollection = db.collection('barangay-id');
    const barangayId = await barangayIdCollection.findOne({ _id: new ObjectId(id) });
    res.json(barangayId);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});


app.post('/barangay-ids', async (req, res) => {
  const newBarangayId = req.body;
  try {
      const barangayIdCollection = db.collection('barangay-id');
      await barangayIdCollection.insertOne(newBarangayId);
      res.status(200).send('Barangay ID added successfully');
  } catch (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
  }
});

app.put('/barangay-ids/:id', async (req, res) => {
  const id = req.params.id;
  const updatedBarangayId = req.body;
  try {
      const barangayIdCollection = db.collection('barangay-id');
      await barangayIdCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedBarangayId });
      res.status(200).send('Barangay ID updated successfully');
  } catch (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
  }
});

app.delete('/barangay-ids/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const barangayIdCollection = db.collection('barangay-id');
    await barangayIdCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).send('Barangay ID deleted successfully');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.put('/barangay-ids/transfer/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const barangayIdCollection = db.collection('barangay-id');
      const barangayIdCompleteCollection = db.collection('barangay-id-complete');
      
      // Find the document to transfer
      const barangayId = await barangayIdCollection.findOne({ _id: new ObjectId(id) });
      if (!barangayId) {
          return res.status(404).send('Barangay ID not found');
      }
      
      // Insert the document into barangay-id-complete
      await barangayIdCompleteCollection.insertOne(barangayId);
      
      // Delete the document from barangay-id
      await barangayIdCollection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).send('Barangay ID transferred successfully');
  } catch (err) {
      console.error('Error transferring barangay ID:', err);
      res.status(500).send('Internal Server Error');
  }
});

app.get('/barangay-ids-complete', async (req, res) => {
  try {
      const barangayIdCompleteCollection = db.collection('barangay-id-complete');
      const barangayIds = await barangayIdCompleteCollection.find().toArray();
      res.json(barangayIds);
  } catch (err) {
      console.error('Error fetching complete barangay IDs:', err);
      res.status(500).send('Internal Server Error');
  }
});

// GET /next-igp-no
app.get('/next-igp-no', async (req, res) => {
  try {
    const barangayIdCollection = db.collection('barangay-id'); // Replace with your actual collection name
    const barangayIdCompleteCollection = db.collection('barangay-id-complete'); // Optional, if you have a completed collection

    const [latestPending, latestComplete] = await Promise.all([
      barangayIdCollection.findOne({}, { sort: { igp: -1 } }),
      barangayIdCompleteCollection.findOne({}, { sort: { igp: -1 } })
    ]);

    const getNumericPart = (str) => {
      const match = str ? str.match(/\d+/) : null;
      return match ? parseInt(match[0], 10) : 0;
    };

    const highestNumbers = [
      getNumericPart(latestPending?.igp),
      getNumericPart(latestComplete?.igp)
    ];

    const nextNumber = Math.max(...highestNumbers) + 1;
    const nextIgp = `IGP-${String(nextNumber).padStart(6, '0')}`;

    res.status(200).json({ nextIgp });
  } catch (err) {
    console.error('Error generating next IGP#:', err);
    res.status(500).json({ error: 'Failed to generate IGP#' });
  }
});


app.post('/submit-request', async (req, res) => {
  const newRequest = req.body;
  try {
      const userAccountCollection = db.collection('user-account');
      const user = await userAccountCollection.findOne({ _id: new ObjectId(req.session.userId) });

      if (user.firstname !== newRequest.firstName || user.middlename !== newRequest.middleName || user.lastname !== newRequest.lastName) {
          return res.status(400).send('You can only request documents for yourself.');
      }

      const requestsCollection = db.collection('requests');
      await requestsCollection.insertOne(newRequest);
      res.status(200).send('Request submitted successfully');
  } catch (err) {
      console.error('Error submitting request:', err);
      res.status(500).send('Internal Server Error');
  }
});

// BAGONG LAGAY FOR REQUEST-CERTIFICATION
app.get('/fetch-certification-requests', async (req, res) => {
  try {
      const requestsCollection = db.collection('request-certification');
      const requests = await requestsCollection.find().toArray();
      res.json(requests);
  } catch (err) {
      console.error('Error fetching requests:', err);
      res.status(500).send('Internal Server Error');
  }
});

  // for add request-cert
  app.post('/add-request-certification', async (req, res) => {
    const newRequest = req.body;

    try {
        const requestsCollection = db.collection('request-certification');
        const result = await requestsCollection.insertOne(newRequest);
        const savedRequest = await requestsCollection.findOne({ _id: result.insertedId });
        res.status(200).send({ success: true, request: savedRequest });
    } catch (err) {
        console.error('Error adding request:', err);
        res.status(500).send({ success: false });
    }
});

  //for edit req cert
// Fetch a specific certification request by ID
app.get('/fetch-certification-request/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const requestsCollection = db.collection('request-certification');
      const request = await requestsCollection.findOne({ _id: new ObjectId(id) });
      res.json(request);
  } catch (err) {
      console.error('Error fetching request:', err);
      res.status(500).send('Internal Server Error');
  }
});

// Update a specific certification request by ID
app.put('/update-request-certification/:id', async (req, res) => {
  const id = req.params.id;
  const updatedRequest = req.body;
  try {
      const requestsCollection = db.collection('request-certification');
      await requestsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedRequest });
      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error updating request:', err);
      res.status(500).send({ success: false });
  }
});

// Delete a request-certification
app.delete('/delete-request-certification/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const requestsCollection = db.collection('request-certification');
      await requestsCollection.deleteOne({ _id: new ObjectId(id) });
      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error deleting request:', err);
      res.status(500).send({ success: false });
  }
});

// Route to transfer request from request-certification to request-certification-complete
app.put('/transfer-request-certification/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const requestsCollection = db.collection('request-certification');
      const completedCollection = db.collection('request-certification-complete');
      
      // Find the document to transfer
      const request = await requestsCollection.findOne({ _id: new ObjectId(id) });
      if (!request) {
          return res.status(404).send('Request not found');
      }
      
      // Insert the document into request-certification-complete
      await completedCollection.insertOne(request);
      
      // Delete the document from request-certification
      await requestsCollection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).send('Request transferred successfully');
  } catch (err) {
      console.error('Error transferring request:', err);
      res.status(500).send('Internal Server Error');
  }
});

// BAGONG LAGAY FOR REQUEST-CERTIFICATION-COMPLETE
app.get('/fetch-certification-requests-complete', async (req, res) => {
  try {
      const completedCollection = db.collection('request-certification-complete');
      const requests = await completedCollection.find().toArray();
      res.json(requests);
  } catch (err) {
      console.error('Error fetching completed requests:', err);
      res.status(500).send('Internal Server Error');
  }
});

// BAGONG LAGAY FOR CLEARANCE-REQUEST
// Route to fetch all request-clearance data
app.get('/fetch-clearance-requests', async (req, res) => {
  try {
      const clearanceCollection = db.collection('request-clearance');
      const clearanceRequests = await clearanceCollection.find().toArray();
      res.json(clearanceRequests);
  } catch (err) {
      console.error('Error fetching clearance requests:', err);
      res.status(500).send('Internal Server Error');
  }
});

// Add a new request-clearance
app.post('/add-request-clearance', async (req, res) => {
  const newRequest = req.body;

  try {
      const clearanceCollection = db.collection('request-clearance');
      const result = await clearanceCollection.insertOne(newRequest);
      const savedRequest = await clearanceCollection.findOne({ _id: result.insertedId });
      res.status(200).send({ success: true, request: savedRequest });
  } catch (err) {
      console.error('Error adding request:', err);
      res.status(500).send({ success: false });
  }
});

// Update a specific request-clearance by ID
app.get('/fetch-clearance-request/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const clearanceCollection = db.collection('request-clearance');
      const request = await clearanceCollection.findOne({ _id: new ObjectId(id) });
      if (request) {
          res.json(request);
      } else {
          res.status(404).send('Request not found');
      }
  } catch (err) {
      console.error('Error fetching request:', err);
      res.status(500).send('Internal Server Error');
  }
});

app.put('/update-request-clearance/:id', async (req, res) => {
  const id = req.params.id;
  const updatedRequest = req.body;

  try {
    const clearanceCollection = db.collection('request-clearance');
    await clearanceCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedRequest });
    res.status(200).send({ success: true });
  } catch (err) {
    console.error('Error updating request:', err);
    res.status(500).send({ success: false });
  }
});

// Delete a request-clearance by ID
app.delete('/delete-request-clearance/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const clearanceCollection = db.collection('request-clearance');
    await clearanceCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).send({ success: true });
  } catch (err) {
    console.error('Error deleting request:', err);
    res.status(500).send({ success: false });
  }
});

// Transfer a request-clearance by ID
app.put('/transfer-request-clearance/:id', async (req, res) => {
  const id = req.params.id;

  try {
      const clearanceCollection = db.collection('request-clearance');
      const completedCollection = db.collection('request-clearance-complete');

      // Find the document to transfer
      const request = await clearanceCollection.findOne({ _id: new ObjectId(id) });
      if (!request) {
          return res.status(404).send('Request not found');
      }

      // Insert the document into the request-clearance-complete collection
      await completedCollection.insertOne(request);

      // Delete the document from the request-clearance collection
      await clearanceCollection.deleteOne({ _id: new ObjectId(id) });

      // Send a success response
      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error transferring request:', err);
      res.status(500).send({ success: false });
  }
});

// BAGONG LAGAY KAY CLEARANCE REQUEST COMPLETE
// Fetch all completed request-clearance data
app.get('/fetch-clearance-requests-complete', async (req, res) => {
  try {
      const clearanceCompleteCollection = db.collection('request-clearance-complete');
      const clearanceRequestsComplete = await clearanceCompleteCollection.find().toArray();
      res.json(clearanceRequestsComplete);
  } catch (err) {
      console.error('Error fetching completed clearance requests:', err);
      res.status(500).send('Internal Server Error');
  }
});

// BAGONG LAGAY FOR REQUEST-INDIGENCY
// Route to fetch all request-indigency data
app.get('/fetch-indigency-requests', async (req, res) => {
  try {
      const indigencyCollection = db.collection('request-indigency');
      const indigencyRequests = await indigencyCollection.find().toArray();
      res.json(indigencyRequests);
  } catch (err) {
      console.error('Error fetching indigency requests:', err);
      res.status(500).send('Internal Server Error');
  }
});

// ADDING NEW INDIGENCY REQ
app.post('/add-request-indigency', async (req, res) => {
  const newRequest = req.body;

  try {
      const indigencyCollection = db.collection('request-indigency');
      const result = await indigencyCollection.insertOne(newRequest);
      const savedRequest = await indigencyCollection.findOne({ _id: result.insertedId });
      res.status(200).send({ success: true, request: savedRequest });
  } catch (err) {
      console.error('Error adding request:', err);
      res.status(500).send({ success: false });
  }
});

// EDIT INDIGENCY REQ
// Fetch a single request for editing
app.get('/fetch-indigency-request/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const requestsCollection = db.collection('request-indigency');
      const request = await requestsCollection.findOne({ _id: new ObjectId(id) });
      res.json(request);
  } catch (err) {
      console.error('Error fetching request:', err);
      res.status(500).send('Internal Server Error');
  }
});

// Update a specific indigency request
app.put('/update-request-indigency/:id', async (req, res) => {
  const id = req.params.id;
  const updatedRequest = req.body;
  try {
      const requestsCollection = db.collection('request-indigency');
      const result = await requestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedRequest }
      );
      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error updating request:', err);
      res.status(500).send({ success: false });
  }
});

// DELETE INDIGENCY REQ
// Delete a request-indigency by ID
app.delete('/delete-request-indigency/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const requestsCollection = db.collection('request-indigency');
      await requestsCollection.deleteOne({ _id: new ObjectId(id) });
      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error deleting request:', err);
      res.status(500).send({ success: false });
  }
});

// TRANSFER COMPLETE INDIGENCY REQ
// Route to transfer request from request-indigency to request-indigency-complete
app.put('/transfer-request-indigency/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const indigencyCollection = db.collection('request-indigency');
      const indigencyCompleteCollection = db.collection('request-indigency-complete');

      // Find the document to transfer
      const request = await indigencyCollection.findOne({ _id: new ObjectId(id) });
      if (!request) {
          return res.status(404).send('Request not found');
      }

      // Insert the document into request-indigency-complete
      await indigencyCompleteCollection.insertOne(request);

      // Delete the document from request-indigency
      await indigencyCollection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error transferring request:', err);
      res.status(500).send({ success: false, message: 'Internal Server Error' });
    }
});

// BAGONG LAGAY FOR REQUEST-INDIGENCY COMPLETE
app.get('/fetch-indigency-requests-complete', async (req, res) => {
  try {
      const indigencyCompleteCollection = db.collection('request-indigency-complete');
      const indigencyRequestsComplete = await indigencyCompleteCollection.find().toArray();
      res.json(indigencyRequestsComplete);
  } catch (err) {
      console.error('Error fetching completed indigency requests:', err);
      res.status(500).send('Internal Server Error');
  }
});

// BAGONG LAGAY FOR BLOTTER
// fetch blotter data
app.get('/fetch-blotter', async (req, res) => {
  try {
    const blotterCollection = db.collection('blotter');
    const moduleCollection = db.collection('module'); // Assuming 'module' stores the people (e.g., 'Imbestigador')

    // Fetch blotter data with justiceOnDuty populated
    const blotters = await blotterCollection.aggregate([
      {
        $lookup: {
          from: 'module', // module collection where the justiceOnDuty data is stored
          localField: 'justiceOnDuty', // local field in blotter collection that stores the ObjectId
          foreignField: '_id', // the field in module collection to match with
          as: 'justiceOnDutyDetails' // output array field with joined data
        }
      },
      {
        $unwind: { 
          path: '$justiceOnDutyDetails', 
          preserveNullAndEmptyArrays: true // in case there are blotters without a justiceOnDuty yet
        }
      },
      {
        $addFields: {
          justiceOnDutyName: {
            $concat: ['$justiceOnDutyDetails.firstName', ' ', '$justiceOnDutyDetails.lastName']
          }
        }
      }
    ]).toArray();

    res.json(blotters); // send back the updated blotter list with justiceOnDutyName populated
  } catch (err) {
    console.error('Error fetching blotter data:', err);
    res.status(500).send('Internal Server Error');
  }
});

// GET route to fetch the next number considering all complaint collections
// Endpoint to get the next available Blotter No with the prefix "SF-"
app.get('/next-blotter-no', async (req, res) => {
  try {
    const blotterCollection = db.collection('blotter');
    const blotterCompleteCollection = db.collection('blotter-complete');
    const luponCollection = db.collection('lupon');
    const luponCompleteCollection = db.collection('lupon-complete');
    const cfaCollection = db.collection('cfa');
    const cfaCompleteCollection = db.collection('cfa-complete');

    // Get the highest number from all relevant collections
    const [latestBlotter, latestBlotterComplete, latestLupon, latestLuponComplete, latestCfa, latestCfaComplete] = await Promise.all([
      blotterCollection.findOne({}, { sort: { blotterNo: -1 } }),
      blotterCompleteCollection.findOne({}, { sort: { blotterNo: -1 } }),
      luponCollection.findOne({}, { sort: { usapinBlg: -1 } }),
      luponCompleteCollection.findOne({}, { sort: { usapinBlg: -1 } }),
      cfaCollection.findOne({}, { sort: { brgyCaseNo: -1 } }),
      cfaCompleteCollection.findOne({}, { sort: { brgyCaseNo: -1 } })
    ]);

    // Extract the numeric parts from the latest numbers
    const getNumericPart = (str) => {
      const match = str ? str.match(/\d+/) : null;
      return match ? parseInt(match[0], 10) : 0;
    };

    const highestNumbers = [
      getNumericPart(latestBlotter?.blotterNo),
      getNumericPart(latestBlotterComplete?.blotterNo),
      getNumericPart(latestLupon?.usapinBlg),
      getNumericPart(latestLuponComplete?.usapinBlg),
      getNumericPart(latestCfa?.brgyCaseNo),
      getNumericPart(latestCfaComplete?.brgyCaseNo)
    ];

    // Determine the highest number and increment by 1
    const nextNumber = Math.max(...highestNumbers) + 1;
    const nextBlotterNo = `SF-${nextNumber}`;

    // Send the next Blotter No with the prefix
    res.status(200).json({ nextBlotterNo });
  } catch (err) {
    console.error('Error fetching next Blotter No:', err);
    res.status(500).send({ error: 'Failed to get next Blotter No.' });
  }
});


// fetch kasunduan data
app.get('/fetch-kasunduan', async (req, res) => {
  try {
    const kasunduanCollection = db.collection('blotter-kasunduan');
    const kasunduanData = await kasunduanCollection.find().toArray();
    res.json(kasunduanData);
  } catch (err) {
    console.error('Error fetching kasunduan data:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Add a new blotter
app.post('/add-blotter', async (req, res) => {
  try {
    // Get the next available Blotter No
    const nextBlotterNoResponse = await axios.get('http://localhost:8080/next-blotter-no');
    const blotterNo = nextBlotterNoResponse.data.nextBlotterNo;

    // Destructure from the body for clarity
    const {
      date,
      time,
      complainants,   // <-- Now expecting array of objects
      complainees,    // <-- Now expecting array of objects
      blotter,
      reason,
      justiceOnDuty,
      hearingDate,
      hearingTime,
      status
    } = req.body;

    const newBlotter = {
      blotterNo,
      date,
      time,
      complainants,
      complainees,
      blotter,
      reason,
      justiceOnDuty,
      hearingDate,
      hearingTime,
      status: status || 'Processing'
    };

    const blotterCollection = db.collection('blotter');
    const result = await blotterCollection.insertOne(newBlotter);

    res.status(200).send({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error('Error adding blotter:', err);
    res.status(500).send({ success: false, error: err.message });
  }
});


// Add a new kasunduan
app.post('/add-kasunduan', async (req, res) => {
  const newKasunduan = req.body;
  
  try {
      const kasunduanCollection = db.collection('blotter-kasunduan');
      const result = await kasunduanCollection.insertOne(newKasunduan);
      res.status(200).send({ success: true, insertedId: result.insertedId });
  } catch (err) {
      console.error('Error adding kasunduan:', err);
      res.status(500).send({ success: false });
  }
});

//edit blotter table
// Update a specific blotter by ID (add this to server.js)
app.put('/update-blotter/:id', async (req, res) => {
  const id = req.params.id;

  // Get the updated data from the request body
  const updatedBlotter = {
    date: req.body.date,
    time: req.body.time,
    blotter: req.body.blotter,
    reason: req.body.reason,
    justiceOnDuty: req.body.justiceOnDuty,
    hearingDate: req.body.hearingDate,
    hearingTime: req.body.hearingTime,
    status: req.body.status,
    
    // Handle multiple complainants and complainees as arrays
    complainants: req.body.complainants.map(c => ({
      firstName: c.firstName,
      middleName: c.middleName,
      lastName: c.lastName,
    })),
    complainees: req.body.complainees.map(c => ({
      firstName: c.firstName,
      middleName: c.middleName,
      lastName: c.lastName,
    })),
  };

  try {
    const blotterCollection = db.collection('blotter');
    
    // Update the specific blotter document by ID
    await blotterCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedBlotter });

    res.status(200).send({ success: true });
  } catch (err) {
    console.error('Error updating blotter:', err);
    res.status(500).send({ success: false });
  }
});

//edit kasunduan
app.put('/update-kasunduan/:id', async (req, res) => {
  const id = req.params.id;
  const updatedKasunduan = {
      date: req.body.date,
      time: req.body.time,
      complainants: req.body.complainants, 
      complainees: req.body.complainees, 
      kasunduan: req.body.kasunduan,
      justiceOnDuty: req.body.justiceOnDuty,
      status: req.body.status,
  };

  try {
      const kasunduanCollection = db.collection('blotter-kasunduan');
      await kasunduanCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedKasunduan });
      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error updating kasunduan:', err);
      res.status(500).send({ success: false });
  }
});

// delete blotter
app.delete('/delete-blotter/:id', async (req, res) => {
  const blotterId = req.params.id;
  
  try {
    const blotterCollection = db.collection('blotter');
    const result = await blotterCollection.deleteOne({ _id: new ObjectId(blotterId) });
    
    if (result.deletedCount === 1) {
      res.status(200).send({ success: true });
    } else {
      res.status(404).send({ success: false, message: 'Blotter not found' });
    }
  } catch (error) {
    console.error('Error deleting blotter:', error);
    res.status(500).send({ success: false, message: 'Internal Server Error' });
  }
});

// delete kasunduan
app.delete('/delete-kasunduan/:id', async (req, res) => {
  const kasunduanId = req.params.id;
  
  try {
    const kasunduanCollection = db.collection('blotter-kasunduan');
    const result = await kasunduanCollection.deleteOne({ _id: new ObjectId(kasunduanId) });
    
    if (result.deletedCount === 1) {
      res.status(200).send({ success: true });
    } else {
      res.status(404).send({ success: false, message: 'Kasunduan not found' });
    }
  } catch (error) {
    console.error('Error deleting kasunduan:', error);
    res.status(500).send({ success: false, message: 'Internal Server Error' });
  }
});

// transfer blotter to complete
app.put('/transfer-blotter/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const blotterCollection = db.collection('blotter');
      const completeCollection = db.collection('blotter-complete');

      // Find the document to transfer
      const blotter = await blotterCollection.findOne({ _id: new ObjectId(id) });
      if (!blotter) {
          return res.status(404).send('Blotter not found');
      }

      // Insert the document into blotter-complete
      await completeCollection.insertOne(blotter);

      // Delete the document from blotter collection
      await blotterCollection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error transferring blotter:', err);
      res.status(500).send({ success: false });
  }
});

// transfer blotter to lupon
app.put('/transfer-to-lupon/:id', async (req, res) => {
  const blotterId = req.params.id;
  try {
      const blotterCollection = db.collection('blotter');
      const luponCollection = db.collection('lupon');
      const blotterCompleteCollection = db.collection('blotter-complete');

      // Find the blotter entry
      const blotterData = await blotterCollection.findOne({ _id: new ObjectId(blotterId) });
      if (!blotterData) {
          return res.status(404).send('Blotter not found');
      }

      // Prepare data for the Lupon entry with exact field mappings
      const luponData = {
          petsa: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
          usapinBlg: blotterData.blotterNo,
          complainants: blotterData.complainants || [],
          complainees: blotterData.complainees || [],
          sumbong: blotterData.blotter || "",
          lunas: "",
          reason: blotterData.reason || "",
          luponmom: "",
          hearingStage: "1",
          hearingDate: "",
          hearingTime: "",
          pangkatChairperson: "",
          pangkatMember1: "",
          pangkatMember2: "",
          status: "Processing"
      };

      // Insert into the lupon collection
      await luponCollection.insertOne(luponData);

      // Insert the complete blotter data into blotter-complete
      await blotterCompleteCollection.insertOne(blotterData);

      // Delete the blotter entry from the blotter collection
      await blotterCollection.deleteOne({ _id: new ObjectId(blotterId) });

      res.status(200).send({ success: true, message: 'Blotter successfully transferred to Lupon and completed.' });
  } catch (err) {
      console.error('Error transferring blotter to Lupon:', err);
      res.status(500).send({ success: false, message: 'Internal Server Error' });
  }
});


// transfer kasunduan
app.put('/transfer-kasunduan/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const kasunduanCollection = db.collection('blotter-kasunduan');
      const completeCollection = db.collection('blotter-kasunduan-complete');

      // Find the document to transfer
      const kasunduan = await kasunduanCollection.findOne({ _id: new ObjectId(id) });
      if (!kasunduan) {
          return res.status(404).send('Kasunduan not found');
      }

      // Insert the document into kasunduan-complete
      await completeCollection.insertOne(kasunduan);

      // Delete the document from kasunduan collection
      await kasunduanCollection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error transferring kasunduan:', err);
      res.status(500).send({ success: false });
  }
});

// display of blotter complete
app.get('/fetch-completed-blotters', async (req, res) => {
  try {
    const completeCollection = db.collection('blotter-complete');
    const blotters = await completeCollection.find().toArray();
    res.json(blotters);
  } catch (err) {
    console.error('Error fetching completed blotters:', err);
    res.status(500).send('Internal Server Error');
  }
});

// display of blotter kasunduan complete
app.get('/fetch-completed-kasunduan', async (req, res) => {
  try {
    const completeKasunduanCollection = db.collection('blotter-kasunduan-complete');
    const kasunduan = await completeKasunduanCollection.find().toArray();
    res.json(kasunduan);
  } catch (err) {
    console.error('Error fetching completed kasunduan:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Blotter (justice on duty dropdown)

// FOR LUPON.HTML
// DISPLAY LUPON AND KASUNDUAN
app.get('/fetch-lupon', async (req, res) => {
  try {
    const luponCollection = db.collection('lupon');
    const luponData = await luponCollection.find().toArray();
    res.json(luponData);
  } catch (err) {
    console.error('Error fetching lupon data:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/fetch-lupon2', async (req, res) => {
  try {
    const lupon2Collection = db.collection('lupon2');
    const lupon2Data = await lupon2Collection.find().toArray();
    res.json(lupon2Data);
  } catch (err) {
    console.error('Error fetching lupon2 data:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/fetch-lupon3', async (req, res) => {
  try {
    const lupon3Collection = db.collection('lupon3');
    const lupon3Data = await lupon3Collection.find().toArray();
    res.json(lupon3Data);
  } catch (err) {
    console.error('Error fetching lupon3 data:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/fetch-lupon-kasunduan', async (req, res) => {
  try {
    const kasunduanCollection = db.collection('lupon-kasunduan');
    const kasunduanData = await kasunduanCollection.find().toArray();
    res.json(kasunduanData);
  } catch (err) {
    console.error('Error fetching kasunduan data:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ADDING LUPON AND KASUNDUAN
app.post('/add-lupon-kasunduan', async (req, res) => {
  const newKasunduan = req.body;

  try {
      const kasunduanCollection = db.collection('lupon-kasunduan');
      const result = await kasunduanCollection.insertOne(newKasunduan);
      res.status(200).send({ success: true, insertedId: result.insertedId });
  } catch (err) {
      console.error('Error adding Kasunduan:', err);
      res.status(500).send({ success: false });
  }
});

// EDITING LUPON AND KASUNDUAN
// EDITING LUPON 1
app.put('/update-lupon/:id', async (req, res) => {
  const id = req.params.id;

  // Get the updated data from the request body
  const updatedLupon = {
    petsa: req.body.petsa,
    usapinBlg: req.body.usapinBlg,
    sumbong: req.body.sumbong,
    lunas: req.body.lunas,
    reason: req.body.reason,
    luponmom: req.body.luponmom,
    hearingStage: req.body.hearingStage,
    hearingDate: req.body.hearingDate,
    hearingTime: req.body.hearingTime,
    pangkatChairperson: req.body.pangkatChairperson,
    pangkatMember1: req.body.pangkatMember1,
    pangkatMember2: req.body.pangkatMember2,
    status: req.body.status,

    // Handle multiple complainants and complainees as arrays
    complainants: req.body.complainants.map(c => ({
      firstName: c.firstName,
      middleName: c.middleName,
      lastName: c.lastName,
    })),
    complainees: req.body.complainees.map(c => ({
      firstName: c.firstName,
      middleName: c.middleName,
      lastName: c.lastName,
    })),
  };

  try {
    const luponCollection = db.collection('lupon');
    
    // Update the specific Lupon document by ID
    await luponCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedLupon });

    res.status(200).send({ success: true });
  } catch (err) {
    console.error('Error updating Lupon:', err);
    res.status(500).send({ success: false });
  }
});

// EDITING LUPON 2
app.put('/update-lupon2/:id', async (req, res) => {
  const id = req.params.id;

  // Get the updated data from the request body
  const updatedLupon = {
    petsa: req.body.petsa,
    usapinBlg: req.body.usapinBlg,
    sumbong: req.body.sumbong,
    lunas: req.body.lunas,
    reason: req.body.reason,
    luponmom: req.body.luponmom,
    hearingStage: req.body.hearingStage,
    hearingDate: req.body.hearingDate,
    hearingTime: req.body.hearingTime,
    pangkatChairperson: req.body.pangkatChairperson,
    pangkatMember1: req.body.pangkatMember1,
    pangkatMember2: req.body.pangkatMember2,
    status: req.body.status,

    // Handle multiple complainants and complainees as arrays
    complainants: req.body.complainants.map(c => ({
      firstName: c.firstName,
      middleName: c.middleName,
      lastName: c.lastName,
    })),
    complainees: req.body.complainees.map(c => ({
      firstName: c.firstName,
      middleName: c.middleName,
      lastName: c.lastName,
    })),
  };

  try {
    const lupon2Collection = db.collection('lupon2');
    
    // Update the specific Lupon document by ID
    await lupon2Collection.updateOne({ _id: new ObjectId(id) }, { $set: updatedLupon });

    res.status(200).send({ success: true });
  } catch (err) {
    console.error('Error updating Lupon 2:', err);
    res.status(500).send({ success: false });
  }
});

// EDITING LUPON 3
app.put('/update-lupon3/:id', async (req, res) => {
  const id = req.params.id;

  // Get the updated data from the request body
  const updatedLupon = {
    petsa: req.body.petsa,
    usapinBlg: req.body.usapinBlg,
    sumbong: req.body.sumbong,
    lunas: req.body.lunas,
    reason: req.body.reason,
    luponmom: req.body.luponmom,
    hearingStage: req.body.hearingStage,
    hearingDate: req.body.hearingDate,
    hearingTime: req.body.hearingTime,
    pangkatChairperson: req.body.pangkatChairperson,
    pangkatMember1: req.body.pangkatMember1,
    pangkatMember2: req.body.pangkatMember2,
    status: req.body.status,

    // Handle multiple complainants and complainees as arrays
    complainants: req.body.complainants.map(c => ({
      firstName: c.firstName,
      middleName: c.middleName,
      lastName: c.lastName,
    })),
    complainees: req.body.complainees.map(c => ({
      firstName: c.firstName,
      middleName: c.middleName,
      lastName: c.lastName,
    })),
  };

  try {
    const lupon3Collection = db.collection('lupon3');
    
    // Update the specific Lupon document by ID
    await lupon3Collection.updateOne({ _id: new ObjectId(id) }, { $set: updatedLupon });

    res.status(200).send({ success: true });
  } catch (err) {
    console.error('Error updating Lupon 3:', err);
    res.status(500).send({ success: false });
  }
});

app.put('/update-lupon-kasunduan/:id', async (req, res) => {
  const id = req.params.id;
  const updatedKasunduan = req.body;

  try {
      const kasunduanCollection = db.collection('lupon-kasunduan');
      await kasunduanCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedKasunduan });
      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error updating Kasunduan:', err);
      res.status(500).send({ success: false });
  }
});

  // DELETING LUPON AND KASUNDUAN DATA
  app.delete('/delete-lupon/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const luponCollection = db.collection('lupon');
        const result = await luponCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
            res.status(200).send({ success: true });
        } else {
            res.status(404).send({ success: false, message: 'Lupon entry not found' });
        }
    } catch (err) {
        console.error('Error deleting Lupon entry:', err);
        res.status(500).send({ success: false, message: 'Internal Server Error' });
    }
});

// Delete Lupon 2
app.delete('/delete-lupon2/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const lupon2Collection = db.collection('lupon2');
        const result = await lupon2Collection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
            res.status(200).send({ success: true });
        } else {
            res.status(404).send({ success: false, message: 'Hearing 2 entry not found' });
        }
    } catch (err) {
        console.error('Error deleting Hearing 2 entry:', err);
        res.status(500).send({ success: false, message: 'Internal Server Error' });
    }
});

// Delete Lupon 3
app.delete('/delete-lupon3/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const lupon3Collection = db.collection('lupon3');
        const result = await lupon3Collection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
            res.status(200).send({ success: true });
        } else {
            res.status(404).send({ success: false, message: 'Hearing 3 entry not found' });
        }
    } catch (err) {
        console.error('Error deleting Hearing 3 entry:', err);
        res.status(500).send({ success: false, message: 'Internal Server Error' });
    }
});

app.delete('/delete-lupon-kasunduan/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const kasunduanCollection = db.collection('lupon-kasunduan');
      const result = await kasunduanCollection.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 1) {
          res.status(200).send({ success: true });
      } else {
          res.status(404).send({ success: false, message: 'Kasunduan entry not found' });
      }
  } catch (err) {
      console.error('Error deleting Kasunduan entry:', err);
      res.status(500).send({ success: false, message: 'Internal Server Error' });
  }
});

// TRANSFER LUPON AND KASUNDUAN
// Transfer Lupon to Lupon-Complete
app.put('/transfer-lupon/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const luponCollection = db.collection('lupon');
      const completeCollection = db.collection('lupon-complete');

      // Find the document to transfer
      const lupon = await luponCollection.findOne({ _id: new ObjectId(id) });
      if (!lupon) {
          return res.status(404).send('Lupon entry not found');
      }

      // Insert the document into the "lupon-complete" collection
      await completeCollection.insertOne(lupon);

      // Delete the document from the original "lupon" collection
      await luponCollection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error transferring Lupon entry:', err);
      res.status(500).send({ success: false });
  }
});

// Transfer Lupon 1 to Lupon 2
app.put('/transfer-to-lupon2/:id', async (req, res) => {
  const luponId = req.params.id;

  try {
    const luponCollection = db.collection('lupon');
    const lupon2Collection = db.collection('lupon2');
    const luponCompleteCollection = db.collection('lupon-complete');

    // Step 1: Find the Lupon document
    const luponData = await luponCollection.findOne({ _id: new ObjectId(luponId) });
    if (!luponData) {
      return res.status(404).send({ success: false, message: 'Lupon entry not found' });
    }

    // Step 2: Modify the data for lupon2
    const lupon2Data = {
      ...luponData,
      hearingStage: "2", // override
      status: "Processing",
      luponmom: "",
      pangkatChairperson: "",
      pangkatMember1: "",
      pangkatMember2: ""
    };

    // Step 3: Insert into lupon2
    await lupon2Collection.insertOne(lupon2Data);

    // Step 4: Insert original into lupon-complete (as-is)
    await luponCompleteCollection.insertOne(luponData);

    // Step 5: Delete from original lupon
    await luponCollection.deleteOne({ _id: new ObjectId(luponId) });

    res.status(200).send({
      success: true,
      message: 'Lupon successfully transferred to Hearing 2 and archived.',
    });

  } catch (err) {
    console.error('Error during transfer:', err);
    res.status(500).send({ success: false, message: 'Internal Server Error' });
  }
});

// Transfer Lupon2 to Lupon-Complete
app.put('/transfer-lupon2/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const lupon2Collection = db.collection('lupon2');
      const completeCollection = db.collection('lupon-complete');

      // Find the document to transfer
      const lupon2 = await lupon2Collection.findOne({ _id: new ObjectId(id) });
      if (!lupon2) {
          return res.status(404).send('Lupon entry not found');
      }

      // Insert the document into the "lupon-complete" collection
      await completeCollection.insertOne(lupon2);

      // Delete the document from the original "lupon" collection
      await lupon2Collection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error transferring Lupon 2 entry:', err);
      res.status(500).send({ success: false });
  }
});

// Transfer Lupon2 to Lupon3
app.put('/transfer-to-lupon3/:id', async (req, res) => {
  const luponId3 = req.params.id;

  try {
    const lupon2Collection = db.collection('lupon2');
    const lupon3Collection = db.collection('lupon3');
    const luponCompleteCollection = db.collection('lupon-complete');

    // 1. Fetch the entry from lupon2
    const luponData = await lupon2Collection.findOne({ _id: new ObjectId(luponId3) });
    if (!luponData) {
      return res.status(404).json({ success: false, message: 'Lupon entry not found in Hearing 2' });
    }

    // 2. Prepare the data for lupon3
    const lupon3Data = {
      ...luponData,
      hearingStage: "3",
      status: "Processing",
      luponmom: "",
      pangkatChairperson: "",
      pangkatMember1: "",
      pangkatMember2: ""
    };

    // 3. Insert into lupon3
    await lupon3Collection.insertOne(lupon3Data);

    // ✅ 4. Archive to lupon-complete (REMOVE _id)
    const { _id, ...archivedData } = luponData;
    await luponCompleteCollection.insertOne(archivedData);

    // 5. Delete from lupon2
    await lupon2Collection.deleteOne({ _id: new ObjectId(luponId3) });

    // 6. Respond
    res.status(200).json({
      success: true,
      message: 'Lupon successfully transferred to Hearing 3 and archived.'
    });

  } catch (err) {
    console.error('Error during transfer to Hearing 3:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// Transfer Lupon3 to Lupon-Complete
app.put('/transfer-lupon3/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const lupon3Collection = db.collection('lupon3');
      const completeCollection = db.collection('lupon-complete');

      // Find the document to transfer
      const lupon3 = await lupon3Collection.findOne({ _id: new ObjectId(id) });
      if (!lupon3) {
          return res.status(404).send('Lupon entry not found');
      }

      // Insert the document into the "lupon-complete" collection
      await completeCollection.insertOne(lupon3);

      // Delete the document from the original "lupon" collection
      await lupon3Collection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).send({ success: true });
  } catch (err) {
      console.error('Error transferring Hearing 3 entry:', err);
      res.status(500).send({ success: false });
  }
});


// Transfer Kasunduan entry from "lupon-kasunduan" collection to "lupon-kasunduan-complete" collection
app.put('/transfer-lupon-kasunduan/:id', async (req, res) => {
  const id = req.params.id;
  try {
      const kasunduanCollection = db.collection('lupon-kasunduan');
      const completeKasunduanCollection = db.collection('lupon-kasunduan-complete');

      // Find the document to transfer
      const kasunduan = await kasunduanCollection.findOne({ _id: new ObjectId(id) });
      if (!kasunduan) {
          return res.status(404).json({ success: false, message: 'Kasunduan not found' });
      }

      // Insert the document into the "lupon-kasunduan-complete" collection
      await completeKasunduanCollection.insertOne(kasunduan);

      // Delete the document from the original "lupon-kasunduan" collection
      await kasunduanCollection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).json({ success: true });
  } catch (err) {
      console.error('Error transferring Kasunduan entry:', err);
      res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// Transfer Hearing 3 to CFA
app.put('/transfer-to-cfa/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const lupon3Collection = db.collection('lupon3');
    const cfaCollection = db.collection('cfa');
    const luponCompleteCollection = db.collection('lupon-complete');

    const lupon = await lupon3Collection.findOne({ _id: new ObjectId(id) });
    if (!lupon) {
      return res.status(404).send('Lupon entry not found in Hearing 3');
    }

    // ✅ Prepare a properly mapped CFA document
    const cfaData = {
      _id: new ObjectId(),
      brgyCaseNo: lupon.usapinBlg || '',
      reason: lupon.reason || '',
      complainants: lupon.complainants || [],
      complainees: lupon.complainees || [],
      dateIssued: '', 
      pangkatChairperson: lupon.pangkatChairperson || '',
      pangkatMember1: lupon.pangkatMember1 || '',
      pangkatMember2: lupon.pangkatMember2 || '',
      status: 'Processing'
    };

    // ✅ Insert only the mapped version into CFA
    await cfaCollection.insertOne(cfaData);

    // ✅ Archive the original lupon3 into lupon-complete
    const { _id, ...archivedData } = lupon;
    await luponCompleteCollection.insertOne({ ...archivedData, _id: new ObjectId() });

    // ✅ Delete the original lupon3 entry
    await lupon3Collection.deleteOne({ _id: new ObjectId(id) });

    res.status(200).send({ success: true });

  } catch (err) {
    console.error('Error transferring to CFA:', err);
    res.status(500).send({ success: false });
  }
});



// BAGONG LAGAY FOR LUPON-COMPLETE.HTML

  // DISPLAY LUPON COMPLETED
app.get('/fetch-completed-lupon', async (req, res) => {
  try {
    const luponCompleteCollection = db.collection('lupon-complete');
    const completedLupon = await luponCompleteCollection.find().toArray();
    res.json(completedLupon); // Return only completed Lupon entries
  } catch (err) {
    console.error('Error fetching completed lupon:', err);
    res.status(500).send('Internal Server Error');
  }
});

// DISPLAY LUPON-KASUNDUAN COMPLETED
app.get('/fetch-completed-lupon-kasunduan', async (req, res) => {
  try {
    const kasunduanCompleteCollection = db.collection('lupon-kasunduan-complete');
    const completedKasunduan = await kasunduanCompleteCollection.find().toArray();
  
    res.json(completedKasunduan); // Return only completed Kasunduan entries
  } catch (err) {
    console.error('Error fetching completed lupon and kasunduan:', err);
    res.status(500).send('Internal Server Error');
  }
});

// BAGONG LAGAY FOR CFA.HTML
  
  // displaying cfa mongo db
  app.get('/fetch-cfa-data', async (req, res) => {
    try {
      const cfaCollection = db.collection('cfa');
      const cfaData = await cfaCollection.find().toArray();
      res.json(cfaData);
    } catch (err) {
      console.error('Error fetching CFA data:', err);
      res.status(500).send('Internal Server Error');
    }
  });

  // adding cfa
  app.post('/add-cfa', async (req, res) => {
    try {
      const cfaCollection = db.collection('cfa');
      const cfaCompleteCollection = db.collection('cfa-complete');
  
      // Fetch the last inserted document from cfa collection
      const latestCfaEntry = await cfaCollection.findOne({}, { sort: { brgyCaseNo: -1 } });
      
      // Fetch the last inserted document from cfa-complete collection
      const latestCfaCompleteEntry = await cfaCompleteCollection.findOne({}, { sort: { brgyCaseNo: -1 } });
  
      // Determine the new Brgy Case No
      let newBrgyCaseNo = 1; // Default to 1 if there are no entries in either collection
  
      if (latestCfaEntry) {
        newBrgyCaseNo = Math.max(newBrgyCaseNo, parseInt(latestCfaEntry.brgyCaseNo, 10) + 1);
      }
  
      if (latestCfaCompleteEntry) {
        newBrgyCaseNo = Math.max(newBrgyCaseNo, parseInt(latestCfaCompleteEntry.brgyCaseNo, 10) + 1);
      }
  
      // Create the new CFA data with the incremented Brgy Case No
      const newCfa = {
        ...req.body,
        brgyCaseNo: newBrgyCaseNo.toString(), // Convert to string for MongoDB
      };
  
      // Insert the new CFA into the collection
      const result = await cfaCollection.insertOne(newCfa);
  
      // Return success message with inserted document's ID
      res.status(200).send({ success: true, brgyCaseNo: newBrgyCaseNo, insertedId: result.insertedId });
    } catch (err) {
      console.error('Error adding CFA:', err);
      res.status(500).send({ success: false, message: 'Error adding CFA', error: err.message });
    }
  });
  

// GET route to fetch the next Brgy Case No
app.get('/next-brgy-case-no-cfa', async (req, res) => {
  try {
      const cfaCollection = db.collection('cfa');
      const cfaCompleteCollection = db.collection('cfa-complete');
      
      // Find the highest brgyCaseNo in both collections
      const highestCfaCase = await cfaCollection.find().sort({ brgyCaseNo: -1 }).limit(1).toArray();
      const highestCfaCompleteCase = await cfaCompleteCollection.find().sort({ brgyCaseNo: -1 }).limit(1).toArray();
      
      // Extract the highest number
      const highestCaseNoCfa = highestCfaCase[0]?.brgyCaseNo || 0;
      const highestCaseNoComplete = highestCfaCompleteCase[0]?.brgyCaseNo || 0;
      
      // Get the maximum of both
      const nextBrgyCaseNo = Math.max(highestCaseNoCfa, highestCaseNoComplete) + 1;
      
      res.json({ nextBrgyCaseNo });
  } catch (err) {
      console.error("Error fetching next brgyCaseNo:", err);
      res.status(500).json({ error: "Internal Server Error" });
  }
});

  // editing cfa
  app.put('/update-cfa/:id', async (req, res) => {
    const id = req.params.id;
    const updatedCFA = req.body;
  
    try {
      const cfaCollection = db.collection('cfa');
      await cfaCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedCFA });
      res.status(200).send({ success: true });
    } catch (err) {
      console.error('Error updating CFA:', err);
      res.status(500).send({ success: false });
    }
  });
  
  // deleting cfa
  app.delete('/delete-cfa/:id', async (req, res) => {
    const id = req.params.id;
    try {
      const cfaCollection = db.collection('cfa');
      const result = await cfaCollection.deleteOne({ _id: new ObjectId(id) });
      
      if (result.deletedCount === 1) {
        res.status(200).send({ success: true });
      } else {
        res.status(404).send({ success: false, message: 'CFA entry not found' });
      }
    } catch (err) {
      console.error('Error deleting CFA:', err);
      res.status(500).send({ success: false });
    }
  });

  // transfer cfa to complete
  app.put('/transfer-cfa/:id', async (req, res) => {
    const id = req.params.id;
    try {
      const cfaCollection = db.collection('cfa');
      const completeCollection = db.collection('cfa-complete');
  
      // Find the document to transfer
      const cfa = await cfaCollection.findOne({ _id: new ObjectId(id) });
      if (!cfa) {
        return res.status(404).json({ success: false, message: 'CFA not found' }); // Proper JSON format
      }
  
      // Insert the document into "cfa-complete"
      await completeCollection.insertOne(cfa);
  
      // Delete the document from "cfa" collection
      await cfaCollection.deleteOne({ _id: new ObjectId(id) });
  
      res.status(200).json({ success: true }); // Respond with JSON
    } catch (err) {
      console.error('Error transferring CFA:', err);
      res.status(500).json({ success: false, message: 'Internal Server Error' }); // Error response in JSON
    }
  });
  

// BAGONG LAGAY FOR CFA-COMPLETE.HTML

  // display cfa-complete mongodb
app.get('/fetch-cfa-complete-data', async (req, res) => {
  try {
    const cfaCompleteCollection = db.collection('cfa-complete');
    const cfaCompleteData = await cfaCompleteCollection.find().toArray();
    res.json(cfaCompleteData);
  } catch (err) {
    console.error('Error fetching completed CFA data:', err);
    res.status(500).send('Internal Server Error');
  }
});


  
/************************ ADMIN SIDE END ************************/ 







/************************ GENERATE START ************************/

// Fetch a specific blotter by ID
app.get('/fetch-blotter/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const blotterCollection = db.collection('blotter');
    const blotter = await blotterCollection.findOne({ _id: new ObjectId(id) });
    res.json(blotter);
  } catch (err) {
    console.error('Error fetching blotter by ID:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Fetch a specific kasunduan by ID from the 'blotter-kasunduan' collection
app.get('/fetch-blotter-kasunduan/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const kasunduanCollection = db.collection('blotter-kasunduan');
    const kasunduan = await kasunduanCollection.findOne({ _id: new ObjectId(id) });
    res.json(kasunduan);
  } catch (err) {
    console.error('Error fetching kasunduan by ID:', err);
    res.status(500).send('Internal Server Error');
  }
});

// HEARING 1
app.get('/fetch-lupon/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const luponCollection = db.collection('lupon');
    const lupon = await luponCollection.findOne({ _id: new ObjectId(id) });
    res.json(lupon);
  } catch (err) {
    console.error('Error fetching Lupon:', err);
    res.status(500).send('Internal Server Error');
  }
});

// HEARING 2
app.get('/fetch-lupon2/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const lupon2Collection = db.collection('lupon2');
    const lupon2 = await lupon2Collection.findOne({ _id: new ObjectId(id) });
    res.json(lupon2);
  } catch (err) {
    console.error('Error fetching Lupon 2:', err);
    res.status(500).send('Internal Server Error');
  }
});

// HEARING 3
app.get('/fetch-lupon3/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const lupon3Collection = db.collection('lupon3');
    const lupon3 = await lupon3Collection.findOne({ _id: new ObjectId(id) });
    res.json(lupon3);
  } catch (err) {
    console.error('Error fetching Lupon 3:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/fetch-lupon-complete/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const completeCollection = db.collection('lupon-complete');
    const record = await completeCollection.findOne({ _id: new ObjectId(id) });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Lupon Complete entry not found' });
    }

    res.json(record);
  } catch (err) {
    console.error('Error fetching from Lupon Complete:', err);
    res.status(500).send('Internal Server Error');
  }
});


app.get('/fetch-lupon-kasunduan/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const kasunduanCollection = db.collection('lupon-kasunduan');
    const kasunduan = await kasunduanCollection.findOne({ _id: new ObjectId(id) });
    res.json(kasunduan);
  } catch (err) {
    console.error('Error fetching Kasunduan:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/fetch-cfa-data/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const cfaCollection = db.collection('cfa');
    const cfaData = await cfaCollection.findOne({ _id: new ObjectId(id) });
    res.json(cfaData);
  } catch (err) {
    console.error('Error fetching CFA data:', err);
    res.status(500).send('Internal Server Error');
  }
});

//Generate Send Email
app.post('/api/patawag/send-email', async (req, res) => {
  const { complainantName, complaineeName, usapinBarangayBlg, reason, date, hearingDate, hearingTime } = req.body;

  const baseUrl = process.env.PUPPETEER_DEV
  const url = `${baseUrl}/generate-patawag.html?usapinBarangayBlg=${encodeURIComponent(usapinBarangayBlg)}&complainants=${encodeURIComponent(complainantName)}&complainees=${encodeURIComponent(complaineeName)}&reason=${encodeURIComponent(reason)}&date=${encodeURIComponent(date)}&hearingDate=${encodeURIComponent(hearingDate)}&hearingTime=${encodeURIComponent(hearingTime)}`;
  const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' }); // Ensure page is fully loaded

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true
  });

  await browser.close();

  const residentCollection = db.collection('resident');
  const emailsToFind = [complainantName, complaineeName];
  const foundEmails = [];

 for (const name of emailsToFind) {
  if (!name || typeof name !== 'string') {
    return res.status(400).json({
      success: false,
      message: `Invalid name value provided: ${name}`
    });
  }

  const resident = await residentCollection.findOne({
    $expr: {
      $eq: [
        {
          $concat: [
            "$Firstname", " ",
            { $cond: [{ $eq: ["$Middlename", ""] }, "", { $concat: ["$Middlename", " "] }] },
            "$Lastname"
          ]
        },
        name.trim()
      ]
    }
  });

  if (!resident) {
    return res.status(400).json({
      success: false,
      message: `${name} was not found in the registered residents.`
    });
  }

  if (!resident['e-mail']) {
    return res.status(400).json({
      success: false,
      message: `${name} does not have a registered email.`
    });
  }

  foundEmails.push(resident['e-mail']);
}

  // Send email with PDF
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: foundEmails,
    subject: 'Official Summon – Patawag Letter',
    text: `Good day,

Please find attached your official Patawag Letter issued by Barangay Santa Fe, City of Dasmariñas. Your attendance is required at the indicated date and time to address the matter specified.

Failure to comply without valid reason may result in appropriate action.

Thank you for your cooperation.

— Barangay Santa Fe, City of Dasmariñas`,
    attachments: [
      {
        filename: 'patawag.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  };

  transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.error('Email sending failed:', error);
      return res.status(500).json({ success: false, message: 'Failed to send email' });
    } else {
      console.log('Email sent:', info.response);
      res.json({ success: true, message: 'Patawag email sent successfully' });
    }
  });
});

app.post('/api/lupon-patawag/send-email', async (req, res) => {
  const { complainantName, complaineeName, usapinBarangayBlg, reason, date, hearingDate, hearingTime } = req.body;
  const baseUrl = process.env.PUPPETEER_DEV;

  const url = `${baseUrl}/generate-lupon-patawag.html?usapinBlg=${encodeURIComponent(usapinBarangayBlg)}&nagsumbong=${encodeURIComponent(complainantName)}&labanKay=${encodeURIComponent(complaineeName)}&reason=${encodeURIComponent(reason)}&date=${encodeURIComponent(date)}&hearingDate=${encodeURIComponent(hearingDate)}&hearingTime=${encodeURIComponent(hearingTime)}`;

  const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true
  });

  await browser.close();

  const residentCollection = db.collection('resident');
  const emailsToFind = [complainantName, complaineeName];
  const foundEmails = [];

  for (const name of emailsToFind) {
    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        message: `Invalid name value provided: ${name}`
      });
    }

    const resident = await residentCollection.findOne({
      $expr: {
        $eq: [
          {
            $concat: [
              "$Firstname", " ",
              { $cond: [{ $eq: ["$Middlename", ""] }, "", { $concat: ["$Middlename", " "] }] },
              "$Lastname"
            ]
          },
          name.trim()
        ]
      }
    });

    if (!resident) {
      return res.status(400).json({
        success: false,
        message: `${name} was not found in the registered residents.`
      });
    }

    if (!resident['e-mail']) {
      return res.status(400).json({
        success: false,
        message: `${name} does not have a registered email.`
      });
    }

    foundEmails.push(resident['e-mail']);
  }

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: foundEmails,
    subject: 'Official Summon – Lupon Patawag Letter',
    text: `Good day,

Please find attached your official Lupon Patawag Letter issued by Barangay Santa Fe, City of Dasmariñas. Your presence is required at the stated hearing date and time.

Failure to appear without valid reason may result in further action.

Thank you for your cooperation.

— Barangay Santa Fe, City of Dasmariñas`,
    attachments: [
      {
        filename: 'lupon-patawag.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  };

  transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.error('Email sending failed:', error);
      return res.status(500).json({ success: false, message: 'Failed to send email' });
    } else {
      console.log('Email sent:', info.response);
      res.json({ success: true, message: 'Lupon Patawag email sent successfully' });
    }
  });
});


// POST route to add a new elected official (without photo for now)
// Route to add a new elected officer
app.post('/modules', CloudUpload.single('photo'), async (req, res) => {
  try {
    const { firstName, middleName, lastName, position } = req.body;
    const moduleCollection = db.collection('module');
    const residentCollection = db.collection('resident');

    const resident = await residentCollection.findOne({
      Firstname: { $regex: new RegExp(`^${firstName}$`, 'i') },
      Middlename: { $regex: new RegExp(`^${middleName}$`, 'i') },
      Lastname: { $regex: new RegExp(`^${lastName}$`, 'i') }
    });

    if (!resident) {
      return res.status(400).json({ success: false, message: 'This person is not in the resident collection.' });
    }

    const existingOfficial = await moduleCollection.findOne({
      firstName: { $regex: new RegExp(`^${firstName}$`, 'i') },
      middleName: { $regex: new RegExp(`^${middleName}$`, 'i') },
      lastName: { $regex: new RegExp(`^${lastName}$`, 'i') }
    });

    if (existingOfficial) {
      return res.status(400).json({ success: false, message: 'This person is already assigned to a position.' });
    }

    const keyPositions = ['Punong Barangay', 'Secretary', 'Treasurer', 'SK Chairperson', 'Lupon Chairperson'];
    if (keyPositions.includes(position)) {
      const positionExists = await moduleCollection.findOne({ position });
      if (positionExists) {
        return res.status(400).json({ success: false, message: `Position ${position} is already filled.` });
      }
    }

    const profilePicUrl = req.file?.path || '';

    const newOfficial = { firstName, middleName, lastName, position, Profilepic: profilePicUrl };
    await moduleCollection.insertOne(newOfficial);

    res.status(201).json({ success: true, message: 'Official added successfully' });
  } catch (err) {
    console.error('Error adding official:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

//for edit
app.get('/modules/:id', async (req, res) => {
  const id = req.params.id;

  try {
      const moduleCollection = db.collection('module');
      const official = await moduleCollection.findOne({ _id: new ObjectId(id) });

      if (!official) {
          return res.status(404).send('Official not found');
      }

      res.json(official);
  } catch (err) {
      console.error('Error fetching official:', err);
      res.status(500).send('Internal Server Error');
  }
});

// Route to edit an existing elected officer
app.put('/modules/:id', CloudUpload.single('photo'), async (req, res) => {
  const id = req.params.id;
  const { firstName, middleName, lastName, position } = req.body;
  const profilePicUrl = req.file?.path || req.body.existingPic || ""; // fallback to old pic if not re-uploaded

  const residentCollection = db.collection('resident');
  const moduleCollection = db.collection('module');

  try {
    const resident = await residentCollection.findOne({
      Firstname: { $regex: new RegExp(`^${firstName}$`, 'i') },
      Middlename: { $regex: new RegExp(`^${middleName}$`, 'i') },
      Lastname: { $regex: new RegExp(`^${lastName}$`, 'i') }
    });

    if (!resident) {
      return res.status(400).json({ success: false, message: 'This person is not in the resident collection.' });
    }

    const existingOfficial = await moduleCollection.findOne({
      firstName: { $regex: new RegExp(`^${firstName}$`, 'i') },
      middleName: { $regex: new RegExp(`^${middleName}$`, 'i') },
      lastName: { $regex: new RegExp(`^${lastName}$`, 'i') },
      _id: { $ne: new ObjectId(id) }
    });

    if (existingOfficial) {
      return res.status(400).json({ success: false, message: 'This person is already assigned to a position.' });
    }

    const keyPositions = ['Punong Barangay', 'Secretary', 'Treasurer', 'SK Chairperson', 'Lupon Chairperson'];
    if (keyPositions.includes(position)) {
      const positionExists = await moduleCollection.findOne({ position, _id: { $ne: new ObjectId(id) } });
      if (positionExists) {
        return res.status(400).json({ success: false, message: `Position ${position} is already filled.` });
      }
    }

    const updatedOfficial = {
      firstName,
      middleName,
      lastName,
      position,
      Profilepic: profilePicUrl
    };

    const result = await moduleCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedOfficial });

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, message: 'Official not found' });
    } else {
      res.status(200).json({ success: true, message: 'Official updated successfully' });
    }
  } catch (err) {
    console.error('Error updating official:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

app.delete('/modules/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const moduleCollection = db.collection('module');
    await moduleCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).send('Elected Official deleted successfully');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

/************************ MODULE END ************************/


/************** WELCOME AND HOME PAGE START *****************/

// BAGONG LAGAY FOR WELCOME AND HOME PAGE (MAINTENANCE)

// Endpoint to fetch officials
app.get('/get-officials', async (req, res) => {
  try {
    const moduleCollection = db.collection('module');
    // Fetch officials data
    const officials = await moduleCollection.find().toArray();
    res.json(officials); // Send officials data as JSON
  } catch (err) {
    console.error('Error fetching officials:', err);
    res.status(500).send('Internal Server Error');
  }
});


/************** WELCOME AND HOME PAGE START *****************/

/**************  CONNECT MODULE IN DROPDOWNS *****************/
// Blotter Justice On Duty
app.get('/fetch-justice-on-duty', async (req, res) => {
  try {
    const moduleCollection = db.collection('module'); // Use the correct collection name
    const justiceList = await moduleCollection.find({ position: 'Imbestigador' }).toArray(); // Fetch only those with 'Imbestigador' position
    res.json(justiceList); // Send the filtered list back to the client
  } catch (err) {
    console.error('Error fetching justice on duty:', err);
    res.status(500).send('Internal Server Error');
  }
});

// CFA Pangkat Chairperson and Pangkat Members
// Fetch Pangkat Chairperson
app.get('/fetch-pangkat-chairperson', async (req, res) => {
  try {
      const moduleCollection = db.collection('module');
      const chairpersons = await moduleCollection.find({ position: 'Lupon Chairperson' }).toArray();
      res.json(chairpersons);
  } catch (err) {
      console.error('Error fetching Pangkat Chairperson:', err);
      res.status(500).send('Internal Server Error');
  }
});

// Fetch Pangkat Members (Tagapamayapa)
app.get('/fetch-pangkat-members', async (req, res) => {
  try {
      const moduleCollection = db.collection('module');
      const pangkatMembers = await moduleCollection.find({ position: 'Lupon Tagapamayapa' }).toArray();
      res.json(pangkatMembers);
  } catch (err) {
      console.error('Error fetching Pangkat Members:', err);
      res.status(500).send('Internal Server Error');
  }
});

/************** CONNECT MODULE IN DROPDOWNS END*****************/

/************** CONNECT MODULE IN CERTIFICATES START*****************/

// for punong barangay

app.get('/fetch-punong-barangay', async (req, res) => {
  try {
    const moduleCollection = db.collection('module');
    const punongBarangay = await moduleCollection.findOne({ position: 'Punong Barangay' });
    if (punongBarangay) {
      res.json({ name: `${punongBarangay.firstName} ${punongBarangay.middleName} ${punongBarangay.lastName}` });
    } else {
      res.status(404).json({ message: 'Punong Barangay not found' });
    }
  } catch (err) {
    console.error('Error fetching Punong Barangay:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Fetch Barangay Secretary
app.get('/fetch-secretary', async (req, res) => {
  try {
    const moduleCollection = db.collection('module');
    const secretary = await moduleCollection.findOne({ position: 'Secretary' });
    if (secretary) {
      res.json({ name: `${secretary.firstName} ${secretary.middleName} ${secretary.lastName}` });
    } else {
      res.status(404).json({ message: 'Secretary not found' });
    }
  } catch (err) {
    console.error('Error fetching Secretary:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Fetch Barangay Treasurer
app.get('/fetch-treasurer', async (req, res) => {
  try {
    const moduleCollection = db.collection('module');
    const treasurer = await moduleCollection.findOne({ position: 'Treasurer' });
    if (treasurer) {
      res.json({ name: `${treasurer.firstName} ${treasurer.middleName} ${treasurer.lastName}` });
    } else {
      res.status(404).json({ message: 'Treasurer not found' });
    }
  } catch (err) {
    console.error('Error fetching Treasurer:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Fetch Barangay Kagawads
// Fetch only the first 7 Barangay Kagawads
app.get('/fetch-kagawads', async (req, res) => {
  try {
    const moduleCollection = db.collection('module');
    // Fetch only the first 7 Kagawads
    const kagawads = await moduleCollection.find({ position: 'Kagawad' }).limit(7).toArray();
    if (kagawads.length > 0) {
      const kagawadNames = kagawads.map(kagawad => `${kagawad.firstName} ${kagawad.middleName} ${kagawad.lastName}`);
      res.json(kagawadNames);
    } else {
      res.status(404).json({ message: 'No Kagawads found' });
    }
  } catch (err) {
    console.error('Error fetching Kagawads:', err);
    res.status(500).send('Internal Server Error');
  }
});


// Fetch SK Chairperson
app.get('/fetch-sk-chairperson', async (req, res) => {
  try {
    const moduleCollection = db.collection('module');
    const skChairperson = await moduleCollection.findOne({ position: 'SK Chairperson' });
    if (skChairperson) {
      res.json({ name: `${skChairperson.firstName} ${skChairperson.middleName} ${skChairperson.lastName}` });
    } else {
      res.status(404).json({ message: 'SK Chairperson not found' });
    }
  } catch (err) {
    console.error('Error fetching SK Chairperson:', err);
    res.status(500).send('Internal Server Error');
  }
});


/************** CONNECT MODULE IN CERTIFICATES END*****************/


/************** PAYMONGO START *****************/
app.post('/request-cert-payment', async (req, res) => {
  const { firstName, middleName, lastName } = req.body;

  try {
     // Query the resident collection for the user's email
     const resident = await db.collection('resident').findOne({
        Firstname: { $regex: new RegExp(`^${firstName}$`, 'i') },
        Middlename: { $regex: new RegExp(`^${middleName}$`, 'i') },
        Lastname: { $regex: new RegExp(`^${lastName}$`, 'i') }
     });

     if (!resident) {
        return res.status(404).json({ success: false, message: 'Resident not found' });
     }

     const userEmail = resident['e-mail']; // Assuming email is stored in 'e-mail'

     // Define the apiKey from environment variable
     const apiKey = process.env.PAYMONGO_SECRET_KEY;
     const encodedKey = Buffer.from(apiKey).toString('base64');

     // Generate PayMongo Payment Link
     const paymentResponse = await axios.post('https://api.paymongo.com/v1/links', {
        data: {
           attributes: {
              amount: 10000,  // Replace with actual amount in centavos
              description: "Certificate Request",
              remarks: `${firstName} ${middleName} ${lastName}'s Document Request`
           }
        }
     }, {
        headers: {
           'Authorization': `Basic ${encodedKey}`, // Pass the encoded key here
           'Content-Type': 'application/json'
        }
     });

     const paymentLink = paymentResponse.data.data.attributes.checkout_url;

     // Send Payment Link via Email using Nodemailer
     let transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
           user: process.env.EMAIL_USER, // Use the email from .env
           pass: process.env.EMAIL_PASSWORD // Use the password from .env
        }
     });

     let mailOptions = {
      from: process.env.EMAIL_USER,
      to: userEmail,
      subject: 'Payment Link for Your Document Request - Certification',
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 30px;">
          <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 20px;">
            <h2 style="color: #116530;">Barangay Santa Fe</h2>
            <p style="font-size: 16px; color: #333;">Hello <strong>${firstName}</strong>,</p>
            <p style="font-size: 15px; color: #555;">
              Thank you for requesting a <strong>Barangay Certification</strong>. To proceed, please complete your payment by clicking the button below:
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${paymentLink}" style="background-color: #116530; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Pay Now</a>
            </div>
            <p style="font-size: 14px; color: #777;">
              We will send an email if your Barangay Clearance is ready for pick up.
            </p>
            <p style="font-size: 14px; color: #555;">Thank you,<br><strong>Barangay Santa Fe</strong></p>
          </div>
        </div>
      `,
      cc: 'brgysantafe@dasmarinas',
      replyTo: 'brgysantafe@dasmarinas'
    };
    

     // Send the email
     transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
           console.log('Error sending email:', error);
           return res.status(500).json({ success: false, message: 'Error sending email' });
        } else {
           console.log('Email sent: ' + info.response);
           // Send the email address along with the payment link
           return res.status(200).json({ success: true, paymentLink, email: userEmail });
        }
     });

  } catch (error) {
     console.error('Error:', error.response ? error.response.data : error.message);
     res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
});

app.post('/request-clear-payment', async (req, res) => {
  const { firstName, middleName, lastName } = req.body;

  try {
      // Query the resident collection for the user's email
      const resident = await db.collection('resident').findOne({
          Firstname: { $regex: new RegExp(`^${firstName}$`, 'i') },
          Middlename: { $regex: new RegExp(`^${middleName}$`, 'i') },
          Lastname: { $regex: new RegExp(`^${lastName}$`, 'i') }
      });

      if (!resident) {
          return res.status(404).json({ success: false, message: 'Resident not found' });
      }

      const userEmail = resident['e-mail']; // Assuming email is stored in 'e-mail'

      // Define the apiKey from environment variable
      const apiKey = process.env.PAYMONGO_SECRET_KEY;
      const encodedKey = Buffer.from(apiKey).toString('base64');

      // Generate PayMongo Payment Link for clearance
      const paymentResponse = await axios.post('https://api.paymongo.com/v1/links', {
          data: {
              attributes: {
                  amount: 10000,  // Replace with actual amount in centavos for clearance (e.g., 150.00 PHP = 15000 centavos)
                  description: "Clearance Request",
                  remarks: `${firstName} ${middleName} ${lastName}'s Clearance Request`
              }
          }
      }, {
          headers: {
              'Authorization': `Basic ${encodedKey}`, // Pass the encoded key here
              'Content-Type': 'application/json'
          }
      });

      const paymentLink = paymentResponse.data.data.attributes.checkout_url;

      // Send Payment Link via Email using Nodemailer
      let transporter = nodemailer.createTransport({
          service: 'Gmail',
          auth: {
              user: process.env.EMAIL_USER, // Use the email from .env
              pass: process.env.EMAIL_PASSWORD // Use the password from .env
          }
      });

      let mailOptions = {
        from: process.env.EMAIL_USER,
        to: userEmail,
        subject: 'Payment Link for Your Document Request - Clearance',
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 30px;">
            <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 20px;">
              <h2 style="color: #116530;">Barangay Santa Fe</h2>
              <p style="font-size: 16px; color: #333;">Hello <strong>${firstName}</strong>,</p>
              <p style="font-size: 15px; color: #555;">
                We received your request for a <strong>Barangay Clearance</strong>. To proceed with your application, please complete the payment by clicking the button below:
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${paymentLink}" style="background-color: #116530; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Pay Now</a>
              </div>
              <p style="font-size: 14px; color: #777;">
                 We will send an email if your Barangay Clearance is ready for pick up.
              </p>
              <p style="font-size: 14px; color: #555;">Thank you,<br><strong>Barangay Santa Fe</strong></p>
            </div>
          </div>
        `,
        cc: 'brgysantafe@dasmarinas',
        replyTo: 'brgysantafe@dasmarinas'
      };
      

      // Send the email
      transporter.sendMail(mailOptions, function (error, info) {
          if (error) {
              console.log('Error sending email:', error);
              return res.status(500).json({ success: false, message: 'Error sending email' });
          } else {
              console.log('Email sent: ' + info.response);
              return res.status(200).json({ success: true, paymentLink, email: userEmail });
          }
      });

  } catch (error) {
      console.error('Error:', error.response ? error.response.data : error.message);
      res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
});

app.post('/request-indi-payment', async (req, res) => {
  const { firstName, middleName, lastName } = req.body;

  try {
      // Query the resident collection for the user's email
      const resident = await db.collection('resident').findOne({
          Firstname: { $regex: new RegExp(`^${firstName}$`, 'i') },
          Middlename: { $regex: new RegExp(`^${middleName}$`, 'i') },
          Lastname: { $regex: new RegExp(`^${lastName}$`, 'i') }
      });

      if (!resident) {
          return res.status(404).json({ success: false, message: 'Resident not found' });
      }

      const userEmail = resident['e-mail']; // Assuming email is stored in 'e-mail'

      // Define the apiKey from environment variable
      const apiKey = process.env.PAYMONGO_SECRET_KEY;
      const encodedKey = Buffer.from(apiKey).toString('base64');

      // Generate PayMongo Payment Link for indigency
      const paymentResponse = await axios.post('https://api.paymongo.com/v1/links', {
          data: {
              attributes: {
                  amount: 10000,  // Replace with actual amount in centavos for indigency (e.g., 100.00 PHP = 10000 centavos)
                  description: "Indigency Request",
                  remarks: `${firstName} ${middleName} ${lastName}'s Indigency Request`
              }
          }
      }, {
          headers: {
              'Authorization': `Basic ${encodedKey}`, // Pass the encoded key here
              'Content-Type': 'application/json'
          }
      });

      const paymentLink = paymentResponse.data.data.attributes.checkout_url;

      // Send Payment Link via Email using Nodemailer
      let transporter = nodemailer.createTransport({
          service: 'Gmail',
          auth: {
              user: process.env.EMAIL_USER, // Use the email from .env
              pass: process.env.EMAIL_PASSWORD // Use the password from .env
          }
      });

      let mailOptions = {
        from: process.env.EMAIL_USER,
        to: userEmail,
        subject: 'Payment Link for Your Document Request - Indigency',
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 30px;">
            <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 20px;">
              <h2 style="color: #116530;">Barangay Santa Fe</h2>
              <p style="font-size: 16px; color: #333;">Hello <strong>${firstName}</strong>,</p>
              <p style="font-size: 15px; color: #555;">
                We received your request for a <strong>Certificate of Indigency</strong>. To proceed with your application, kindly complete the payment by clicking the button below:
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${paymentLink}" style="background-color: #116530; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Pay Now</a>
              </div>
              <p style="font-size: 14px; color: #777;">
                 We will send an email if your Barangay Indigency is ready for pick up.
              </p>
              <p style="font-size: 14px; color: #555;">Thank you,<br><strong>Barangay Santa Fe</strong></p>
            </div>
          </div>
        `,
        cc: 'brgysantafe@dasmarinas',
        replyTo: 'brgysantafe@dasmarinas'
      };
      

      // Send the email
      transporter.sendMail(mailOptions, function (error, info) {
          if (error) {
              console.log('Error sending email:', error);
              return res.status(500).json({ success: false, message: 'Error sending email' });
          } else {
              console.log('Email sent: ' + info.response);
              return res.status(200).json({ success: true, paymentLink, email: userEmail });
          }
      });

  } catch (error) {
      console.error('Error:', error.response ? error.response.data : error.message);
      res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
});

/************** PAYMONGO END *****************/

/************** NOTIFICATION VIA EMAIL START *****************/
app.get('/api/residents/search', async (req, res) => {
  const { query } = req.query;
  const regex = new RegExp(query, 'i'); // Case-insensitive search
  const residents = await db.collection('resident').find({
    $or: [
      { Firstname: regex },
      { Middlename: regex },
      { Lastname: regex }
    ]
  }).project({ Firstname: 1, Middlename: 1, Lastname: 1, 'e-mail': 1 }).toArray();
  res.json(residents);
});

// Assuming you have an established MongoDB client connection
app.post('/api/notification/send-email', LocalUpload.single('attachment'), async (req, res) => {
  console.log("Received email send request");
  
  let { to, subject, message } = req.body;
  const attachment = req.file;
  let recipients = [];

  if (req.body.sendToAll === 'true') {
      console.log("Fetching all resident emails...");
      try {
        const residentsCollection = db.collection("resident");
        const allResidents = await residentsCollection.find({}, { projection: { 'e-mail': 1 } }).toArray();
        recipients = allResidents.map(resident => resident['e-mail']);
        console.log("Fetched resident emails:", recipients);
      } catch (error) {
          console.error("Error fetching resident emails:", error);
          return res.status(500).json({ success: false, message: 'Error fetching resident emails' });
      }
  } else if (req.body.organizations) {
    // ✅ Send to selected organizations
    try {
        const organizations = JSON.parse(req.body.organizations);
        console.log("Sending to organizations:", organizations);

        const residentsCollection = db.collection("resident");

        const matchedResidents = await residentsCollection.find(
            { Organization: { $in: organizations } },
            { projection: { 'e-mail': 1 } }
        ).toArray();

        recipients = matchedResidents.map(r => r['e-mail']);
        console.log("Emails from organizations:", recipients);
    } catch (err) {
        console.error("Error fetching emails by organization:", err);
        return res.status(500).json({ success: false, message: 'Failed to fetch emails by organization' });
    }
} else {
    // ✅ Fallback: manually typed emails in "to" field
    recipients = to.split(',').map(email => email.trim());
    console.log("Directly specified recipients:", recipients);
}

  let attachments = [];
  if (attachment) {
      const filePath = path.join(__dirname, attachment.path);
      attachments.push({
          filename: attachment.originalname,
          path: filePath,
          contentType: attachment.mimetype,
      });
      console.log("Attachment added:", attachment.originalname);
  }

  const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipients,
      subject,
      text: message,
      attachments,
  };

  console.log("Attempting to send email...");

  // Respond immediately to prevent pending request
  res.status(200).json({ success: true, message: 'Email is being sent' });

  transporter.sendMail(mailOptions, function (error, info) {
      if (attachment) {
          const filePath = path.join(__dirname, attachment.path);
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) console.error("Error cleaning up file:", unlinkErr);
            else console.log("Attachment file deleted after sending.");
          });
      }

      if (error) {
          console.error("Error sending email:", error);
      } else {
          console.log('Email sent successfully:', info.response);
      }
  });
});


/************** NOTIFICATION VIA EMAIL END *****************/

// Get count of "Processing" requests in request-certification collection
app.get('/count-processing-certifications', async (req, res) => {
  try {
      const requestsCollection = db.collection('request-certification');
      const count = await requestsCollection.countDocuments({ status: 'Processing' });
      res.json({ count });
  } catch (err) {
      console.error('Error fetching count:', err);
      res.status(500).json({ count: 0 });
  }
});

app.get('/count-processing-clearance', async (req, res) => {
  try {
      const requestsCollection = db.collection('request-clearance');
      const count = await requestsCollection.countDocuments({ status: 'Processing' });
      res.json({ count });
  } catch (err) {
      console.error('Error fetching count:', err);
      res.status(500).json({ count: 0 });
  }
});

app.get('/count-processing-indigency', async (req, res) => {
  try {
      const requestsCollection = db.collection('request-indigency');
      const count = await requestsCollection.countDocuments({ status: 'Processing' });
      res.json({ count });
  } catch (err) {
      console.error('Error fetching count:', err);
      res.status(500).json({ count: 0 });
  }
});

//Notif for complaints
app.get('/complaint-notification-counts', async (req, res) => {
  try {
    const blotter = db.collection('blotter');
    const blotterKasunduan = db.collection('blotter-kasunduan');
    const lupon = db.collection('lupon');
    const lupon2 = db.collection('lupon2');
    const lupon3 = db.collection('lupon3');
    const luponKasunduan = db.collection('lupon-kasunduan');
    const cfa = db.collection('cfa');

    const [
      blotterCount,
      blotterKasunduanCount,
      luponCount,
      lupon2Count,
      lupon3Count,
      luponKasunduanCount,
      cfaCount
    ] = await Promise.all([
      blotter.countDocuments({ status: 'Processing' }),
      blotterKasunduan.countDocuments({ status: 'Processing' }),
      lupon.countDocuments({ status: 'Processing' }),
      lupon2.countDocuments({ status: 'Processing' }),
      lupon3.countDocuments({ status: 'Processing' }),
      luponKasunduan.countDocuments({ status: 'Processing' }),
      cfa.countDocuments({ status: 'Processing' })
    ]);

    res.json({
      blotterKasunduan: blotterCount + blotterKasunduanCount,
      luponKasunduan: luponCount + lupon2Count + lupon3Count + luponKasunduanCount,
      cfa: cfaCount
    });
  } catch (error) {
    console.error('Error fetching notification counts:', error);
    res.status(500).json({
      blotterKasunduan: 0,
      luponKasunduan: 0,
      cfa: 0
    });
  }
});

// Side bar notification
app.get('/count-all-processing-requests', async (req, res) => {
  try {
      const certificationCollection = db.collection('request-certification');
      const clearanceCollection = db.collection('request-clearance');
      const indigencyCollection = db.collection('request-indigency');

      const [certCount, clearCount, indigencyCount] = await Promise.all([
          certificationCollection.countDocuments({ status: 'Processing' }),
          clearanceCollection.countDocuments({ status: 'Processing' }),
          indigencyCollection.countDocuments({ status: 'Processing' })
      ]);

      const totalCount = certCount + clearCount + indigencyCount;
      res.json({ totalCount });
  } catch (err) {
      console.error('Error fetching total processing count:', err);
      res.status(500).json({ totalCount: 0 });
  }
});

app.get('/complaint-counts', async (req, res) => {
  try {
    const blotterCollection = db.collection('blotter');
    const blotterKasunduanCollection = db.collection('blotter-kasunduan');
    const luponCollection = db.collection('lupon');
    const lupon2Collection = db.collection('lupon2');
    const lupon3Collection = db.collection('lupon3');
    const luponKasunduanCollection = db.collection('lupon-kasunduan');
    const cfaCollection = db.collection('cfa');

    const [
      blotterCount,
      blotterKasunduanCount,
      luponCount,
      lupon2Count,
      lupon3Count,
      luponKasunduanCount,
      cfaCount
    ] = await Promise.all([
      blotterCollection.countDocuments({ status: 'Processing' }),
      blotterKasunduanCollection.countDocuments({ status: 'Processing' }),
      luponCollection.countDocuments({ status: 'Processing' }),
      lupon2Collection.countDocuments({ status: 'Processing' }),
      lupon3Collection.countDocuments({ status: 'Processing' }),
      luponKasunduanCollection.countDocuments({ status: 'Processing' }),
      cfaCollection.countDocuments({ status: 'Processing' })
    ]);

    const totalComplaints =
      blotterCount + blotterKasunduanCount +
      luponCount + lupon2Count + lupon3Count + luponKasunduanCount +
      cfaCount;

    res.json({
      blotterCount,
      blotterKasunduanCount,
      luponCount,
      lupon2Count,
      lupon3Count,
      luponKasunduanCount,
      cfaCount,
      totalComplaints
    });
  } catch (err) {
    console.error('Error fetching complaint counts:', err);
    res.status(500).json({
      blotterCount: 0,
      blotterKasunduanCount: 0,
      luponCount: 0,
      lupon2Count: 0,
      lupon3Count: 0,
      luponKasunduanCount: 0,
      cfaCount: 0,
      totalComplaints: 0
    });
  }
});



app.get('/count-processing-barangay-id', async (req, res) => {
  try {
      const barangayIdCollection = db.collection('barangay-id');

      const barangayIdCount = await barangayIdCollection.countDocuments({ status: 'Processing' });

      res.json({ barangayIdCount });
  } catch (err) {
      console.error('Error fetching Barangay ID count:', err);
      res.status(500).json({ barangayIdCount: 0 });
  }
});
