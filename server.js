require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const winston = require("winston");
const { Server } = require("socket.io");
const http = require("http");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "server.log" }),
  ],
});

// Security & performance middleware
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(cors({ origin: ["https://your-frontend-domain.com"], methods: ["GET", "POST"] }));

// Rate Limiting to prevent API abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per 15 min
  message: "Too many requests, please try again later."
});
app.use("/generate-image", apiLimiter);

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

// Set up file storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: "AI_Generated_Images", format: "png" },
});
const upload = multer({ storage });

// Stable Diffusion API Route
app.post("/generate-image", async (req, res) => {
  try {
    const { prompt, width, height } = req.body;
    const response = await axios.post(
      "https://api.stability.ai/v2beta/stable-image/generate/sd3",
      { prompt, width: width || 512, height: height || 512, samples: 1 },
      { headers: { Authorization: `Bearer ${process.env.STABLE_DIFFUSION_API_KEY}`, "Content-Type": "application/json" } }
    );
    const imageUrl = response.data.artifacts[0].base64;
    res.json({ status: "success", image: `data:image/png;base64,${imageUrl}` });
  } catch (error) {
    logger.error("Error generating image: ", error);
    res.status(500).json({ status: "error", message: "Image generation failed", error: error.message });
  }
});

// Upload Image to Cloudinary
app.post("/upload-image", upload.single("image"), (req, res) => {
  res.json({ status: "success", url: req.file.path });
});

// WebSocket Connection
io.on("connection", (socket) => {
  logger.info(`User connected: ${socket.id}`);
  socket.on("request-image", async (prompt) => {
    try {
      const response = await axios.post(
        "https://api.stability.ai/v2beta/stable-image/generate/sd3",
        { prompt, width: 512, height: 512, samples: 1 },
        { headers: { Authorization: `Bearer ${process.env.STABLE_DIFFUSION_API_KEY}`, "Content-Type": "application/json" } }
      );
      const imageUrl = response.data.artifacts[0].base64;
      socket.emit("image-response", { status: "success", image: `data:image/png;base64,${imageUrl}` });
    } catch (error) {
      logger.error("WebSocket image generation error: ", error);
      socket.emit("image-response", { status: "error", message: "Image generation failed", error: error.message });
    }
  });
});

// ✅ FIX: Add Default Route to Prevent "Cannot GET /" Error
app.get("/", (req, res) => {
  res.send("AI Image Generator Backend is Running!");
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => logger.info(`Server running on port ${PORT}`));
