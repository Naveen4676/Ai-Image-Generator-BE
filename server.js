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
const io = new Server(server, {
  cors: {
    origin: ["https://naveen4676.github.io", "http://localhost:5500"], // ✅ Allow GitHub Pages & Localhost
    methods: ["GET", "POST"],
  },
});

// ✅ Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "server.log" }),
  ],
});

// ✅ Security & Performance Middleware
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(
  cors({
    origin: ["https://naveen4676.github.io", "http://localhost:5500"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ Rate Limiting to prevent API abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 50,
  message: "Too many requests, please try again later.",
});
app.use("/generate-image", apiLimiter);

// ✅ Configure Cloudinary for Image Storage
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

// ✅ Set up file storage for uploads
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: "AI_Generated_Images", format: "png" },
});
const upload = multer({ storage });

// ✅ Stable Diffusion API Route for Image Generation
app.post("/generate-image", async (req, res) => {
  try {
    const { prompt, width, height } = req.body;

    if (!prompt) {
      return res.status(400).json({ status: "error", message: "Prompt is required!" });
    }

    logger.info(`Generating image for prompt: ${prompt}`);

    const response = await axios.post(
      "https://api.stability.ai/v2beta/stable-image/generate/sd3",
      {
        prompt,
        width: width || 512,
        height: height || 512,
        samples: 1,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.STABLE_DIFFUSION_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const imageUrl = response.data.artifacts[0].base64;
    res.json({ status: "success", image: `data:image/png;base64,${imageUrl}` });
  } catch (error) {
    logger.error("Error generating image: ", error.response?.data || error.message);
    res.status(500).json({
      status: "error",
      message: "Image generation failed",
      error: error.response?.data || error.message,
    });
  }
});

// ✅ Upload Image to Cloudinary
app.post("/upload-image", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: "error", message: "No file uploaded!" });
  }
  res.json({ status: "success", url: req.file.path });
});

// ✅ WebSocket Connection for Real-Time Image Generation
io.on("connection", (socket) => {
  logger.info(`User connected: ${socket.id}`);

  socket.on("request-image", async (prompt) => {
    try {
      if (!prompt) {
        return socket.emit("image-response", {
          status: "error",
          message: "Prompt is required!",
        });
      }

      socket.emit("status", { status: "generating" });

      logger.info(`Generating image for WebSocket prompt: ${prompt}`);

      const response = await axios.post(
        "https://api.stability.ai/v2beta/stable-image/generate/sd3",
        { prompt, width: 512, height: 512, samples: 1 },
        {
          headers: {
            Authorization: `Bearer ${process.env.STABLE_DIFFUSION_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const imageUrl = response.data.artifacts[0].base64;
      socket.emit("image-response", {
        status: "success",
        image: `data:image/png;base64,${imageUrl}`,
      });
    } catch (error) {
      logger.error("WebSocket image generation error: ", error.response?.data || error.message);
      socket.emit("image-response", {
        status: "error",
        message: "Image generation failed",
        error: error.response?.data || error.message,
      });
    }
  });

  socket.on("disconnect", () => {
    logger.info(`User disconnected: ${socket.id}`);
  });
});

// ✅ Default Route to Fix "Cannot GET /" Error
app.get("/", (req, res) => {
  res.send("AI Image Generator Backend is Running!");
});

// ✅ Start Server on Render Assigned Port
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => logger.info(`Server running on port ${PORT}`));
