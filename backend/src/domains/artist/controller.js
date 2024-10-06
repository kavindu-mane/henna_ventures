const Artist = require('./model');
const bcrypt = require('bcryptjs');
const ConfirmArtistModel = require('../admin/models/confirmArtist');
const createToken = require("./../../util/createToken");
const sendEmail = require('../../util/sendEmail');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const verifyToken = require('./../../middleware/auth');
const catchAsyncError = require('./../../middleware/catchAsyncError');

const storage = multer.memoryStorage(); // Use memoryStorage to handle files in memory


// Configure file filter
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF, DOC, and DOCX are allowed.'));
    }
};

// Initialize upload
const upload = multer({
    storage: storage,
    fileFilter: fileFilter
});

exports.upload = upload;

exports.registerArtist = async (req, res) => {
  try {
      const { full_name, phone, email, location, nearest_customers } = req.body;
      const previous_work = {
          data: req.files['previous_work'][0].buffer,
          contentType: req.files['previous_work'][0].mimetype
      };
      const e_certificate = {
          data: req.files['e_certificate'][0].buffer,
          contentType: req.files['e_certificate'][0].mimetype
      };

      const newArtist = new Artist({ 
          full_name, phone, email, location, previous_work, e_certificate, nearest_customers 
      });

      await newArtist.save();
      res.status(201).json({ message: 'Artist registered successfully' });
  } catch (error) {
      res.status(400).json({ error: error.message });
  }
};
exports.downloadFile = async (req, res) => {
  try {
      const { artistId, fileType } = req.params;
      const artist = await Artist.findById(artistId);

      if (!artist) {
          return res.status(404).json({ message: 'Artist not found' });
      }

      let file;
      if (fileType === 'previous_work') {
          file = artist.previous_work;
      } else if (fileType === 'e_certificate') {
          file = artist.e_certificate;
      } else {
          return res.status(400).json({ message: 'Invalid file type requested' });
      }

      console.log("File Data:", file.data);
      console.log("File Content Type:", file.contentType);
      console.log("File Filename:", file.filename);

      if (!file.data || !file.contentType) {
          return res.status(400).json({ message: 'File data or content type is missing' });
      }

      res.set('Content-Type', file.contentType);
      res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.data);
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
};

exports.approveArtist = async (req, res) => {
    try {
        const { artistId } = req.params;
        const { username, password } = req.body;

        const artist = await Artist.findById(artistId);
        if (!artist) {
            return res.status(404).json({ message: 'Artist not found' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        artist.username = username;
        artist.password = hashedPassword;
        artist.is_approved = true;

        await artist.save();

        // Send email
        const mailOptions = {
            from: process.env.AUTH_EMAIL,
            to: artist.email,
            subject: 'Account Approved',
            text: `Your account has been approved. Your username is ${username} and your password is ${password}`
        };

        await sendEmail(mailOptions);
        res.status(200).json({ message: 'Artist approved and email sent' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};
exports.getAllArtists = async (req, res) => {
    try {
        const artists = await Artist.find({});
        res.status(200).json(artists);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Controller function to handle artist login
exports.loginArtist = async (req, res) => {
    try {
      const { username, password } = req.body;
  
      const confirmartist = await ConfirmArtistModel.findOne({ username });
      if (!confirmartist || !confirmartist.is_approved) {
        return res.status(401).json({ message: "Invalid credentials or account not approved" });
      }
  
      const isMatch = await bcrypt.compare(password, confirmartist.password);
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
  
      // Create user token with artistId
      const tokenData = { artistId: confirmartist._id, email: confirmartist.email };
      const token = await createToken(tokenData);
  
      res.status(200).json({ token, message: "Login successful" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  };
  
  
// Controller function to change artist's password
exports.changePassword = [
  verifyToken, // Ensure the user is authenticated
  async (req, res) => {
    const { oldPassword, password, confirmPassword } = req.body;

    // Check if all necessary fields are provided
    if (!oldPassword || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide old password, new password, and confirm password",
      });
    }

    // Check if new password and confirm password match
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New password and confirm password do not match",
      });
    }

    try {
      // Find the current artist by their ID
      const confirmartist = await ConfirmArtistModel.findById(req.currentUser.artistId).select("+password");
      if (!confirmartist) {
        return res.status(404).json({
          success: false,
          message: "Artist not found",
        });
      }

      // Compare old password with stored password
      const isPasswordMatched = await bcrypt.compare(oldPassword, confirmartist.password);
      if (!isPasswordMatched) {
        return res.status(400).json({
          success: false,
          message: "Old password is incorrect",
        });
      }

      // Hash the new password and update it in the database
      const hashedPassword = await bcrypt.hash(password, 10);
      confirmartist.password = hashedPassword;

      // Save the updated artist record
      await confirmartist.save();

      // Generate a new token for the user if needed
      const tokenData = { artistId: confirmartist._id, email: confirmartist.email };
      const token = await createToken(tokenData);

      // Return success response with a new token
      res.status(200).json({
        success: true,
        message: "Password updated successfully",
        token: token,
      });

    } catch (error) {
      console.error("Error updating password:", error);
      return res.status(500).json({ error: error.message });
    }
  },
];
  
  module.exports = exports;