import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";

dotenv.config();
const app = express();
app.use(express.json());

// CORS configuration for production
const corsOptions = {
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// ---------- Database ----------
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("Mongo Error:", err));

// ---------- Models ----------
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Video" }],
  history:   [{ type: mongoose.Schema.Types.ObjectId, ref: "Video" }],
});

const videoSchema = new mongoose.Schema({
  title: String,
  description: String,
  category: String,
  externalUrl: String, // if hosted externally
  filePath: String, // if uploaded locally
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Video = mongoose.model("Video", videoSchema);

// ---------- Auth Middleware ----------
const authMiddleware = async (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ---------- Routes ----------
// Signup
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: "Missing fields" });
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: "Email already used" });
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashed });
    await user.save();
    res.json({ message: "User created" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/";
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// Upload endpoint: supports file upload OR externalUrl
app.post("/api/videos/upload", authMiddleware, upload.single("video"), async (req, res) => {
  try {
    const { title, description, category, externalUrl } = req.body;
    if (!title) return res.status(400).json({ error: "Title required" });
    const video = new Video({
      title,
      description,
      category,
      externalUrl: externalUrl || null,
      filePath: req.file ? req.file.path : null,
      uploadedBy: req.user.id,
    });
    await video.save();
    res.json(video);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List + search
app.get("/api/videos", async (req, res) => {
  try {
    const { search, category } = req.query;
    let filter = {};
    if (search) filter.title = new RegExp(search, "i");
    if (category) filter.category = category;
    const videos = await Video.find(filter).sort({ createdAt: -1 });
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single video metadata
app.get("/api/videos/:id/meta", async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Not found" });
    res.json(video);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Stream / serve video file or redirect to external URL
app.get("/api/videos/:id/stream", async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Not found" });
    if (video.externalUrl) return res.redirect(video.externalUrl);
    if (video.filePath) {
      const fullPath = path.resolve(video.filePath);
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File missing" });
      // support range requests
      const stat = fs.statSync(fullPath);
      const fileSize = stat.size;
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;
        const file = fs.createReadStream(fullPath, { start, end });
        const head = {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": "video/mp4",
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          "Content-Length": fileSize,
          "Content-Type": "video/mp4",
        };
        res.writeHead(200, head);
        fs.createReadStream(fullPath).pipe(res);
      }
    } else {
      res.status(400).json({ error: "No stream available" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Favorite
app.post("/api/videos/:id/favorite", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.favorites.includes(req.params.id)) {
      user.favorites.push(req.params.id);
      await user.save();
    }
    res.json(user.favorites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// History
app.post("/api/videos/:id/history", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.history.includes(req.params.id)) {
      user.history.push(req.params.id);
      await user.save();
    }
    res.json(user.history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple user profile
app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cleanup route (only for dev; remove in production)
app.delete("/api/dev/clear", async (req, res) => {
  try {
    await Video.deleteMany({});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
