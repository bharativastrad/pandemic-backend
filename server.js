require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
}));

app.use(express.json());
require("dotenv").config();





let userSockets = {};
const http = require("http");
const { Server } = require("socket.io");
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
// ✅ REPLACE Anthropic with Groq (free)
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// socket handler

/* ------------------ DATABASE CONNECTION ------------------ */

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB Connected"))
.catch((err) => console.log("MongoDB Error:", err));

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

/* ------------------ SCHEMAS ------------------ */

// 👤 USER
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, required: false, default: "" }, // ✅ not required
  vaccinated: Boolean,
  age: Number,
  location: String,
  role: { type: String, default: "user" },
  isBlocked: { type: Boolean, default: false }
});

const User = mongoose.model("User", userSchema);
// 🔔 ALERT SCHEMA
const alertSchema = new mongoose.Schema({
  location: String,
  message: String,
  riskLevel: String, // HIGH, MEDIUM, LOW
  username: String,  // Track which user this is for
  createdAt: { type: Date, default: Date.now }
});

const Alert = mongoose.model("Alert", alertSchema);

// 🤖 PREDICTION
const predictionSchema = new mongoose.Schema({
  region: String,
  riskLevel: String,
  confidence: Number,
  createdAt: { type: Date, default: Date.now }
});

const Prediction = mongoose.model("Prediction", predictionSchema);


// 📊 DATASET (NEW)
const dataSchema = new mongoose.Schema({
  columns: Array,
  missingValues: Number,
  totalRows: Number,

  summary: {
    totalCases: Number,
    vaccinationRate: Number,
    totalPopulation: Number
  },

  regionData: Object, // ✅ ADD THIS

  uploadedAt: { type: Date, default: Date.now }
});
const Dataset = mongoose.model("Dataset", dataSchema);

/* ═══════════════════════════════════════════════════════════════════
   CRITICAL FIX INSTRUCTIONS:
   
   1. SEARCH your server.js for ALL instances of "function sendRegionAlerts"
   2. DELETE EVERY SINGLE ONE (you probably have 2-3 copies)
   3. PASTE THIS VERSION ONLY ONCE, right after the Dataset schema
   
   THE PROBLEM: You have an OLD version at line ~115 that only sends HIGH risk alerts
   and STOPS there, so the better version below never runs.
═══════════════════════════════════════════════════════════════════ */

// ✅ PASTE THIS AFTER: const Dataset = mongoose.model("Dataset", dataSchema);
// ✅ BEFORE: /* ------------------ FILE UPLOAD CONFIG ------------------ */
// Near the top of your file, after http.createServer:



// NOW define sendRiskAlerts() below this

async function sendRegionAlerts() {
  try {
    console.log("\n🔔 ════════ sendRegionAlerts() STARTED ════════");
    
    const latest = await Dataset.findOne().sort({ uploadedAt: -1 });

    if (!latest || !latest.regionData) {
      console.log("❌ No dataset available for alerts");
      return { totalAlerts: 0, totalSMS: 0, totalSockets: 0 };
    }

    console.log("✅ Dataset found!");
    console.log("📊 Regions in dataset:", Object.keys(latest.regionData));

    let totalAlerts = 0;
    let totalSMS = 0;
    let totalSockets = 0;

    // ✅ PROCESS EVERY REGION, NOT JUST HIGH RISK
    for (let region in latest.regionData) {
      const data = latest.regionData[region];
      const riskLevel = (data.risk || "LOW").toUpperCase();

      console.log(`\n📍 ═══ Processing: ${region} ═══`);
      console.log(`   Risk Level: ${riskLevel}`);
      console.log(`   Cases: ${data.cases}`);
      console.log(`   Vaccination Rate: ${data.vaccinationRate}%`);

      // ✅ Find users with CASE-INSENSITIVE matching
      const users = await User.find({
        role: "user",
        isBlocked: false,
        location: { $regex: new RegExp(`^${region.trim()}$`, "i") }
      });

      console.log(`   👥 Users found: ${users.length}`);
      
      if (users.length > 0) {
        console.log(`   User locations:`, users.map(u => `${u.username}(${u.location})`));
      }

      if (users.length === 0) {
        console.log(`   ⚠️ No users in this region - skipping`);
        continue;
      }

      // ✅ Create messages for ALL risk levels
      let alertMessage = "";
      let smsMessage = "";

      if (riskLevel === "HIGH") {
        alertMessage = `🚨 HIGH RISK ALERT in ${region}! Cases: ${data.cases}. Vaccination Rate: ${data.vaccinationRate}%. Please take immediate precautions.`;
        smsMessage = `⚠️ HIGH RISK in ${region}. Cases: ${data.cases}. Wear masks, avoid crowds, get vaccinated. - PandemicAI`;
      } else if (riskLevel === "MEDIUM") {
        alertMessage = `⚠️ MEDIUM RISK in ${region}. Cases: ${data.cases}. Vaccination Rate: ${data.vaccinationRate}%. Stay alert and follow safety protocols.`;
        smsMessage = `⚠️ MEDIUM RISK in ${region}. Cases: ${data.cases}. Stay cautious, maintain hygiene. - PandemicAI`;
      } else {
        alertMessage = `✅ LOW RISK in ${region}. Cases: ${data.cases}. Vaccination Rate: ${data.vaccinationRate}%. Continue following basic safety measures.`;
        smsMessage = `✅ LOW RISK in ${region}. Cases: ${data.cases}. Stay safe! - PandemicAI`;
      }

      // ✅ Send to each user
      for (let user of users) {
        console.log(`\n   📤 Processing user: ${user.username}`);

        // 1. Save to database
        try {
         // Change this in sendRiskAlerts():
await Alert.create({
  location: region.toLowerCase().trim(),
  message:  alertMessage,     // ✅ CORRECT — this is the variable defined above
  riskLevel: riskLevel,
  username: user.username
});
          totalAlerts++;
          console.log(`      ✅ Alert saved to DB`);
        } catch (dbErr) {
          console.error(`      ❌ DB save failed:`, dbErr.message);
        }

        // 2. Socket notification
        const socketId = userSockets[user.username];
        if (socketId && typeof io !== "undefined") {
          try {
            io.to(socketId).emit("region-alert", {
              message: alertMessage,
              risk: riskLevel,
              region: region,
              cases: data.cases,
              vaccinationRate: data.vaccinationRate
            });
            totalSockets++;
            console.log(`      ✅ Socket notification sent`);
          } catch (socketErr) {
            console.error(`      ❌ Socket failed:`, socketErr.message);
          }
        } else {
          console.log(`      ⚠️ User not connected via socket`);
        }

        // 3. SMS notification
        if (user.phone) {
          try {
         
            console.log(`      ✅ SMS sent to +91${user.phone}`);
          } catch (smsErr) {
            console.error(`      ❌ SMS failed:`, smsErr.message);
          }
        } else {
          console.log(`      ⚠️ No phone number`);
        }
      }

      console.log(`   ✅ Completed ${region}: ${users.length} users notified`);
    }

    console.log(`\n🎉 ════════ ALERTS COMPLETE ════════`);
    console.log(`📊 Total Alerts Saved: ${totalAlerts}`);
    console.log(`📲 Total SMS Sent: ${totalSMS}`);
    console.log(`🔌 Total Socket Pushes: ${totalSockets}`);
    console.log(`════════════════════════════════════\n`);

    return { totalAlerts, totalSMS, totalSockets };

  } catch (err) {
    console.error("\n❌ ════════ sendRegionAlerts ERROR ════════");
    console.error(err);
    console.error(`════════════════════════════════════\n`);
    return { totalAlerts: 0, totalSMS: 0, totalSockets: 0 };
  }
}
/* ------------------ FILE UPLOAD CONFIG ------------------ */

const upload = multer({ dest: "uploads/" });

let tempData = [];


/* ------------------ AUTH ROUTES ------------------ */

// ✅ SIGNUP
app.post("/api/signup", async (req, res) => {
  try {
    const {
      username,
      password,
      confirmPassword,
      vaccinated,
      age,
      location,
        phone
    } = req.body;

    if (!username || !password || !confirmPassword || !location) {
      return res.status(400).json({ message: "All fields required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // 🔥 ONLY ONE ADMIN
    let role = "user";

    if (username === "chetana" && password === "Chet@2004") {
      role = "admin";
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      username,
      password: hashedPassword,
        phone,
      vaccinated,
      age,
      location: location.toLowerCase().trim(), // ✅ VERY IMPORTANT
      role
    });

    await newUser.save();

    res.json({ message: "Signup successful", role });

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }
    if (user.isBlocked) {
  return res.status(403).json({ message: "User is blocked" });
}

    // 🔥 EXTRA SECURITY
    if (user.role === "admin") {
      if (username !== "chetana") {
        return res.status(403).json({ message: "Unauthorized admin access" });
      }
    }

    res.json({
      message: "Login successful",
      user: {
        username: user.username,
        role: user.role
      }
    });

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});


// ─────────────────────────────────────────────────────────────────
// GET /api/check-user/:username   (forgot password Step 1)
// ADD this route if it doesn't already exist.
// Returns ONLY { exists: true } or 404 — no user data exposed.
// ─────────────────────────────────────────────────────────────────
app.get("/api/check-user/:username", async (req, res) => {
  try {
    const raw = req.params.username.trim();
 
    // Basic sanity check — prevent regex injection
    if (!raw || raw.length > 64 || /[.*+?^${}()|[\]\\]/.test(raw)) {
      return res.status(400).json({ exists: false, message: "Invalid username." });
    }
 
    const user = await User.findOne({
      username: { $regex: new RegExp(`^${raw}$`, "i") }
    }).select("_id"); // fetch only _id — no sensitive data
 
    if (!user) {
      return res.status(404).json({ exists: false, message: "No account found with that username." });
    }
 
    res.json({ exists: true, message: "Account found." });
 
  } catch (err) {
    res.status(500).json({ message: "Server error." });
  }
});
 
 
// ─────────────────────────────────────────────────────────────────
// POST /api/reset-password   (forgot password Step 2 — self-service)
// ADD this route if it doesn't already exist.
// ─────────────────────────────────────────────────────────────────
app.post("/api/reset-password", async (req, res) => {
  try {
    const { username, newPassword, confirmPassword } = req.body;
 
    // ── Validate inputs ──
    if (!username || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required." });
    }
 
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }
 
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match." });
    }
 
    const raw = username.trim();
    if (!raw || raw.length > 64) {
      return res.status(400).json({ message: "Invalid username." });
    }
 
    // ── Find user ──
    const user = await User.findOne({
      username: { $regex: new RegExp(`^${raw}$`, "i") }
    });
 
    if (!user) {
      // Intentionally vague — don't confirm whether the username exists
      return res.status(404).json({ message: "No account found with that username." });
    }
 
    // ── Prevent resetting admin password via this public endpoint ──
    if (user.role === "admin") {
      return res.status(403).json({ message: "Admin password cannot be reset here. Contact the system owner." });
    }
 
    // ── Hash and save ──
    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    await user.save();
 
    res.json({ message: "Password reset successfully! You can now log in with your new password." });
 
  } catch (err) {
    console.error("Reset password error:", err.message);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});
/* ------------------ DATA MANAGEMENT (AI STYLE) ------------------ */

// 📂 Upload + Analyze CSV
app.post("/api/upload", upload.single("file"), async (req, res) => {
 
  function calculateRisk(data) {
    const cases          = data.cases          || 0;
    const population     = data.population     || 1;
    const vaccinationRate = data.vaccinationRate || 0;
 
    const infectionRate  = (cases / population) * 100;
    const riskScore      = infectionRate * (1 - vaccinationRate / 100);
 
    let risk;
    if (riskScore > 15) risk = "HIGH";
    else if (riskScore > 5) risk = "MEDIUM";
    else risk = "LOW";
 
    // store confidence as 0–1
    const confidence = Math.min(1, (riskScore * 5) / 100);
    return { risk, confidence: Number(confidence.toFixed(4)) };
  }
 
  const results      = [];
  let   missingValues = 0;
 
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (data) => {
      Object.values(data).forEach(val => {
        if (!val || val.toString().trim() === "") missingValues++;
      });
      results.push(data);
    })
    .on("end", async () => {
      fs.unlinkSync(req.file.path);
 
      if (results.length === 0) {
        return res.status(400).json({ message: "Empty dataset" });
      }
 
      const columns = Object.keys(results[0]);
 
      /* ── AUTO-DETECT COLUMNS ── */
      let casesCol      = null;
      let vaccinatedCol = null;   // raw vaccinated count
      let vaccRateCol   = null;   // vaccination_rate % column
      let populationCol = null;
      let regionCol     = null;
      let herdCol       = null;
      let riskCol       = null;   // pre-computed risk column in dataset
 
      columns.forEach(col => {
        const n = col.toLowerCase();
        if (n === "cases"                                          ) casesCol       = col;
        if (n === "vaccinated" && !n.includes("rate")             ) vaccinatedCol  = col;
        if (n === "vaccination_rate" || n === "vaccinationrate"   ) vaccRateCol    = col;
        if (n === "population"                                     ) populationCol  = col;
        if (n === "herd_immunity_status"                          ) herdCol        = col;
        if (n === "risk"                                           ) riskCol        = col;
        if (["region","city","state","area","location"].includes(n)) regionCol      = col;
      });
 
      if (!casesCol || !populationCol) {
        return res.json({
          totalRows: results.length, columns, missingValues,
          warning: "⚠️ Required columns (cases, population) not detected"
        });
      }
 
      /* ── SUMMARY ── */
      let totalCases      = 0;
      let totalVaccinated = 0;
      let totalPopulation = 0;
 
      results.forEach(row => {
        totalCases      += Number(row[casesCol])      || 0;
        totalPopulation += Number(row[populationCol]) || 0;
        if (vaccinatedCol) {
          totalVaccinated += Number(row[vaccinatedCol]) || 0;
        }
      });
 
      const vaccinationRate = totalPopulation > 0
        ? (totalVaccinated / totalPopulation) * 100 : 0;
 
      /* ── REGION GROUPING ── */
      let regionMap = {};
 
      results.forEach(row => {
        const region = regionCol ? row[regionCol] : "Unknown";
        if (!region) return;
 
        const cases      = Number(row[casesCol])      || 0;
        const population = Number(row[populationCol]) || 0;
 
        // prefer vaccination_rate column; fall back to vaccinated/population
        let vaccRate = 0;
        if (vaccRateCol && row[vaccRateCol]) {
          vaccRate = Number(row[vaccRateCol]) || 0;
        } else if (vaccinatedCol && population > 0) {
          vaccRate = (Number(row[vaccinatedCol]) / population) * 100;
        }
 
        const vaccinated   = vaccinatedCol  ? (Number(row[vaccinatedCol])  || 0) : Math.round(population * vaccRate / 100);
        const herdStatus   = herdCol        ? row[herdCol]                         : null;
        const datasetRisk  = riskCol        ? row[riskCol]                         : null;
 
        if (!regionMap[region]) {
          regionMap[region] = {
            cases: 0, vaccinated: 0, population: 0,
            vaccRateSum: 0, rowCount: 0,
            herd_immunity_status: herdStatus,
            datasetRisk
          };
        }
 
        regionMap[region].cases       += cases;
        regionMap[region].vaccinated  += vaccinated;
        regionMap[region].population  += population;
        regionMap[region].vaccRateSum += vaccRate;
        regionMap[region].rowCount    += 1;
 
        // keep first non-null herd status
        if (!regionMap[region].herd_immunity_status && herdStatus) {
          regionMap[region].herd_immunity_status = herdStatus;
        }
      });
 
      // finalise each region
      Object.keys(regionMap).forEach(region => {
        const d = regionMap[region];
 
        // average vaccination rate across rows for this region
        const avgVaccRate = d.rowCount > 0 ? d.vaccRateSum / d.rowCount : 0;
 
        // use dataset's own risk if available, else calculate
        let risk, confidence;
        if (d.datasetRisk) {
          risk = d.datasetRisk.toUpperCase();
          const { confidence: c } = calculateRisk({ cases: d.cases, vaccinationRate: avgVaccRate, population: d.population });
          confidence = c;
        } else {
          const calc = calculateRisk({ cases: d.cases, vaccinationRate: avgVaccRate, population: d.population });
          risk       = calc.risk;
          confidence = calc.confidence;
        }
 
        regionMap[region] = {
          cases:                d.cases,
          vaccinated:           d.vaccinated,
          vaccinationRate:      Number(avgVaccRate.toFixed(2)),
          population:           d.population,
          herd_immunity_status: d.herd_immunity_status || "Not Achieved",
          risk,
          confidence,
        };
      });
 
      /* ── SAVE TO DB ── */
      const dataset = new Dataset({
        columns,
        missingValues,
        totalRows: results.length,
        summary: { totalCases, vaccinationRate, totalPopulation },
        regionData: regionMap
      });
 
      await dataset.save();
      // Inside /api/upload, right after: await dataset.save();

// Populate DatasetRow so sendRiskAlerts() can find data
const today = new Date().toISOString().split("T")[0];
for (const [region, data] of Object.entries(regionMap)) {
  await DatasetRow.findOneAndUpdate(
    { region, date: today },
    {
      region,
      date: today,
      cases: data.cases,
      vaccinated: data.vaccinated,
      population: data.population,
      vaccination_rate: data.vaccinationRate,
      vaccine_available: "No",
      risk: data.risk,  // already computed above
    },
    { upsert: true, new: true }
  );
}

await sendRiskAlerts(); // now DatasetRow has data — this will work
     
 
      /* ── RESPONSE ── */
      res.json({
        totalRows:   results.length,
        columns,
        missingValues,
        detected: {
          casesCol,
          vaccinatedCol,
          vaccRateCol,
          populationCol,
          regionCol,
          herdCol,
          riskCol
        },
        summary: {
          totalCases,
          vaccinationRate,
          totalPopulation
        },
        regionCount: Object.keys(regionMap).length
      });
    });
});
 
// 🧠 Auto Fix Data
app.post("/api/autofix", async (req, res) => {

  if (!tempData.length) {
    return res.status(400).json({ message: "No data to fix" });
  }

  const cleaned = tempData.map(row => {
    let newRow = {};
    for (let key in row) {
      newRow[key] = row[key] || "0";
    }
    return newRow;
  });

  tempData = cleaned;

  res.json({
    message: "Data cleaned successfully",
    totalRows: cleaned.length
  });
});


/* ------------------ AI PREDICTION ROUTES ------------------ */

// ➕ Add Prediction
app.post("/api/predict", async (req, res) => {
  try {
    const { region, riskLevel, confidence } = req.body;

    const newPrediction = new Prediction({
      region,
      riskLevel,
      confidence
    });

    await newPrediction.save();

    res.json({ message: "Prediction saved" });

  } catch (err) {
    res.status(500).json({ message: "Error saving prediction" });
  }
});


// 📊 Get Predictions
app.get("/api/predictions", async (req, res) => {
  try {
    const data = await Prediction.find().sort({ createdAt: -1 });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/* ------------------ DATASETS ------------------ */

// 📂 Get All Datasets
app.get("/api/datasets", async (req, res) => {
  try {
    const data = await Dataset.find().sort({ uploadedAt: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
const axios = require("axios");

/* 🤖 REAL AI PREDICTION */
app.post("/api/ai-predict", async (req, res) => {
  try {
    const { cases, vaccination, population } = req.body;

    const response = await axios.post("http://localhost:5001/predict", {
      cases,
      vaccination,
      population
    });

    const result = response.data;

    // Save in MongoDB
    const newPrediction = new Prediction({
      region: "Dynamic",
      riskLevel: result.risk,
      confidence: result.confidence
    });

    await newPrediction.save();

    res.json(result);

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "AI prediction failed" });
  }
});
// 🔥 GET LATEST DATASET SUMMARY FOR RISK
app.get("/api/latest-dataset", async (req, res) => {
  try {
    const latest = await Dataset.findOne().sort({ uploadedAt: -1 });

    if (!latest) {
      return res.status(404).json({ message: "No dataset found" });
    }

    res.json(latest);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// 🔥 AUTO AI RISK FROM LATEST DATASET
app.get("/api/live-risk", async (req, res) => {
  try {
    const latest = await Dataset.findOne().sort({ uploadedAt: -1 });

    if (!latest || !latest.summary) {
      return res.status(404).json({ message: "No valid dataset" });
    }

    const { totalCases, vaccinationRate, totalPopulation } = latest.summary;

    if (!totalCases || !totalPopulation) {
      return res.status(400).json({ message: "Invalid dataset values" });
    }

    const response = await axios.post("http://localhost:5001/predict", {
      cases: totalCases,
      vaccination: vaccinationRate,
      population: totalPopulation
    });

    const result = response.data;

    await Prediction.create({
      region: "Live",
      riskLevel: result.risk,
      confidence: result.confidence
    });

    res.json({
      dataset: latest,
      risk: result.risk,
      confidence: result.confidence
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Live risk failed" });
  }
});
// 🌍 REGION-WISE AI RISK
app.get("/api/region-risk", async (req, res) => {
  try {
    const latest = await Dataset.findOne().sort({ uploadedAt: -1 });

    if (!latest?.regionData) {
      return res.json([]);
    }

    const regions = Object.entries(latest.regionData).map(([region, data]) => ({
      region,
      ...data
    }));

    return res.json(regions);

  } catch (err) {
    console.error(err);
    return res.json([]);
  }
});
/* ------------------ SERVER ------------------ */
app.delete("/api/delete-dataset", async (req, res) => {
  try {
    await Dataset.deleteMany({});
    res.json({ message: "Dataset deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find({ role: "user" }); // ✅ only users
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
app.put("/api/users/block/:id", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      [{ $set: { isBlocked: { $not: "$isBlocked" } } }], // ✅ toggle without re-validating whole doc
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: user.isBlocked ? "User blocked" : "User unblocked",
      isBlocked: user.isBlocked
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
app.delete("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/user-risk/:location", async (req, res) => {
  try {
    const userLocation = req.params.location.toLowerCase();

    const latest = await Dataset.findOne().sort({ uploadedAt: -1 });

    if (!latest || !latest.regionData) {
      return res.status(404).json({ message: "No dataset available" });
    }

    // 🔍 Find matching region
    let matchedRegion = null;

    for (let region in latest.regionData) {
      if (region.toLowerCase() === userLocation) {
        matchedRegion = region;
        break;
      }
    }

    // ❌ If location not found
    if (!matchedRegion) {
      return res.json({
        found: false,
        message: "Location not found in dataset"
      });
    }

    const data = latest.regionData[matchedRegion];

    const vaccinationRate =
      data.population > 0
        ? (data.vaccinated / data.population) * 100
        : 0;

    // 🤖 CALL AI MODEL
    const axios = require("axios");

    const response = await axios.post("http://localhost:5001/predict", {
      cases: data.cases,
      vaccination: vaccinationRate,
      population: data.population
    });

    const result = response.data;

    res.json({
      found: true,
      region: matchedRegion,
      risk: result.risk,
      confidence: result.confidence
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Error fetching user risk" });
  }
});
// 🔔 GET ALERT FOR USER LOCATION

// 🚀 ADMIN SEND ALERT


// 🔥 GET USER ALERTS BY LOCATION
// ═══════════════════════════════════════════════════════════════════
// CRITICAL FIX: Replace the /api/alerts/:location endpoint in server.js
// ═══════════════════════════════════════════════════════════════════

// 🔥 GET USER ALERTS BY LOCATION (FIXED)


// ═══════════════════════════════════════════════════════════════════
// BONUS: Add this new endpoint to debug location matching
// ═══════════════════════════════════════════════════════════════════

app.get("/api/debug/user-location/:username", async (req, res) => {
  try {
    const { username } = req.params;
    
    const user = await User.findOne({ username });
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const alerts = await Alert.find({
      location: { $regex: new RegExp(`^${user.location}$`, "i") }
    }).sort({ createdAt: -1 });

    const dataset = await Dataset.findOne().sort({ uploadedAt: -1 });
    
    const regionInDataset = dataset?.regionData 
      ? Object.keys(dataset.regionData).find(
          r => r.toLowerCase() === user.location.toLowerCase()
        )
      : null;

    res.json({
      username: user.username,
      userLocation: user.location,
      userLocationLowercase: user.location.toLowerCase(),
      alertsFound: alerts.length,
      alerts: alerts.map(a => ({
        location: a.location,
        risk: a.riskLevel,
        message: a.message,
        createdAt: a.createdAt
      })),
      datasetRegions: dataset?.regionData ? Object.keys(dataset.regionData) : [],
      regionMatchInDataset: regionInDataset,
      matchFound: !!regionInDataset
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 🚨 AUTO SEND ALERTS BASED ON RISK
app.post("/api/auto-alerts", async (req, res) => {
  try {
    // Get the latest uploaded dataset
    const latest = await Dataset.findOne().sort({ uploadedAt: -1 });

    if (!latest || !latest.regionData) {
      return res.status(200).json({ message: "No dataset found" });
    }

    // Build alerts
    const alerts = Object.entries(latest.regionData).map(([region, data]) => {
      let riskLevel = "LOW";
      const ratio = data.cases / data.population;

      if (ratio > 0.3) riskLevel = "HIGH";
      else if (ratio > 0.1) riskLevel = "MEDIUM";

      return {
        region,
        risk: riskLevel,
        cases: data.cases,
        population: data.population,
        vaccinationRate: data.vaccinationRate,
        confidence: data.confidence
      };
    });

    return res.json(alerts);
  } catch (err) {
    console.error("AUTO ALERT ERROR:", err);
    return res.status(500).json({ message: "Auto alert failed" });
  }
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server + Socket running on port ${PORT} - CORS FIXED`);
});
// Add this near the top of server.js where you have other requires

// Modify the sendRegionAlerts function to be more comprehensive
// ═══════════════════════════════════════════════════════════════════
// CRITICAL FIX: Replace the ENTIRE sendRegionAlerts function in server.js
// with this single, working version. Remove ALL other sendRegionAlerts definitions.
// ═══════════════════════════════════════════════════════════════════




// Update the Alert schema to include username and riskLevel


// Update the alerts endpoint to filter by username
app.get("/api/alerts/:location", async (req, res) => {
  try {
    const location = req.params.location.toLowerCase();
    const user = JSON.parse(req.headers['user'] || '{}');

    const alerts = await Alert.find({
      location: location
    }).sort({ createdAt: -1 }).limit(10); // Limit to 10 most recent

    res.json(alerts);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add endpoint to get user-specific alerts
app.get("/api/user-alerts/:username", async (req, res) => {
  try {
    const { username } = req.params;
    
    // Get user's location
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get alerts for user's location
    const alerts = await Alert.find({
      location: { $regex: new RegExp(`^${user.location}$`, "i") }
    }).sort({ createdAt: -1 }).limit(10);

    res.json(alerts);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Socket.IO connection handler
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register-user", (username) => {
    userSockets[username] = socket.id;
    console.log(`User ${username} registered with socket ${socket.id}`);
  });

  socket.on("chat-message", async (msg) => {
    try {
      socket.emit("chat-start");

      const stream = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `You are PandemicAI, an expert medical AI assistant specialized in pandemic health, infectious diseases, vaccines, outbreaks, and public health safety.

RESPONSE FORMAT RULES — follow these strictly every time:
1. Always use markdown formatting in your responses.
2. Use **bold** for key terms, disease names, and important facts.
3. Use ## headings to organize longer answers into clear sections.
4. Use bullet lists (- item) for symptoms, precautions, or multiple points.
5. Use numbered lists (1. step) for procedures or step-by-step guidance.
6. Use \`inline code\` for medical codes, dosages, or technical terms.
7. Start every response with a short, direct answer in 1-2 sentences.
8. Then expand with organized sections if the topic needs more depth.
9. End responses with a **Note:** or **⚠️ Disclaimer:** when giving medical advice, reminding users to consult a healthcare professional.
10. Keep responses clear, accurate, and appropriately detailed — not too short, not overwhelming.`
          },
          { role: "user", content: msg }
        ],
        stream: true,
        max_tokens: 1024,
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || "";
        if (text) socket.emit("chat-stream", text);
      }

      socket.emit("chat-end");

    } catch (err) {
      console.error("Chat error:", err.message);
      socket.emit("chat-stream", "⚠️ AI service error. Please try again.");
      socket.emit("chat-end");
    }
  });

  socket.on("disconnect", () => {
    // Clean up userSockets on disconnect
    for (const [username, id] of Object.entries(userSockets)) {
      if (id === socket.id) {
        delete userSockets[username];
        console.log(`User ${username} disconnected`);
      }
    }
  });
});
// ═══════════════════════════════════════════════════════
//  ADD THESE TO server.js
//  Place schemas near other schemas, routes near other routes
// ═══════════════════════════════════════════════════════

/* ── SCHEMAS ── */

// 💊 Vaccine Inventory
// ═══════════════════════════════════════════════════════
//  ADD THESE TO server.js
//  Replaces previous vaccine routes — region-aware, RV144 only
// ═══════════════════════════════════════════════════════

 // npm install csv-parser


// ═══════════════════════════════════════════════════════════════════
//  VACCINE ROUTES — add to server.js
//
//  How it works:
//  1. Admin uploads a CSV via POST /api/upload-dataset (VaccineAdmin.jsx)
//     → Each row is stored as a DatasetRow document in MongoDB.
//     → The "vaccine_available" column ("Yes" | "Partial" | "No") in the
//       CSV is the SINGLE source of truth for regional availability.
//
//  2. User submits a vaccine request via POST /api/vaccine-request
//     → getRegionAvailability() reads the LATEST DatasetRow per region
//       (sorted by date desc) and checks vaccine_available.
//     → "Yes"     → request confirmed, SMS sent, inventory decremented.
//     → "Partial" → request logged as partial, SMS sent.
//     → "No"      → user waitlisted, SMS sent.
//
//  3. Admin restocks via POST /api/vaccine-restock-region
//     → Inserts a new DatasetRow for that region with today's date and
//       vaccine_available = "Yes" (or whatever newStatus is passed).
//     → All waitlisted users in that region are notified via SMS.
//
//  Dependencies already in server.js: mongoose, multer, twilio (sendSMS), User
//  One extra: multer (already required below — no extra npm install needed
//             if server.js already has it for the /api/upload route).
// ═══════════════════════════════════════════════════════════════════



/* ═══════════════════════════════════════
   SCHEMAS
   (paste near the other mongoose.Schema definitions in server.js)
═══════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════
//  VACCINE + RISK ALERT ROUTES  —  paste into server.js
//
//  HOW IT WORKS (end-to-end):
//  ─────────────────────────────────────────────────────────────────
//  1. Admin uploads CSV via POST /api/upload-dataset
//     → Each row saved as a DatasetRow document in MongoDB
//     → After save, sendRiskAlerts() runs automatically:
//         • Reads the LATEST row per region → gets its `risk` column
//         • Finds every User whose signup `location` matches that region
//         • Sends an SMS to each user with a risk-specific message:
//             HIGH   → urgent warning, urge vaccine + isolation
//             MEDIUM → caution advisory
//             LOW    → all-clear, encourage maintenance
//         • Saves an Alert document (so the bell icon in Navbar shows it)
//         • Emits a socket event to any connected user for instant UI update
//
//  2. `risk` column in CSV is the single source of truth.
//     Accepted values (case-insensitive): HIGH | MEDIUM | LOW
//
//  3. Location matching is case-insensitive and trims whitespace,
//     so "hubli" == "Hubli" == "HUBLI".
//
//  Dependencies already in server.js:
//    mongoose, multer, twilio (sendSMS), User, Alert, io, userSockets
// ═══════════════════════════════════════════════════════════════════


const uploadMiddleware = multer({ storage: multer.memoryStorage() });


/* ══════════════════════════════════════════════════════
   SCHEMAS
   (add near other Schema definitions in server.js)
══════════════════════════════════════════════════════ */

// 💊 Vaccine Inventory
const vaccineInventorySchema = new mongoose.Schema({
  name:      { type: String, required: true, unique: true },
  stock:     { type: Number, default: 0 },
  updatedAt: { type: Date,   default: Date.now },
});
const VaccineInventory = mongoose.model("VaccineInventory", vaccineInventorySchema);

// 📋 Vaccine Request
const vaccineRequestSchema = new mongoose.Schema({
  username:  { type: String, required: true },
  vaccine:   { type: String, required: true },
  region:    { type: String, required: true },
  doses:     { type: Number, default: 1 },
  notes:     { type: String, default: "" },
  status:    { type: String, default: "waitlisted" }, // available | partial | waitlisted | notified
  createdAt: { type: Date,   default: Date.now },
});
const VaccineRequest = mongoose.model("VaccineRequest", vaccineRequestSchema);

// 🗂️ Dataset Row — one document per CSV row. Latest row per region drives everything.
const datasetRowSchema = new mongoose.Schema({
  region:            { type: String, required: true },
  date:              { type: String, required: true }, // "YYYY-MM-DD"
  disease_name:      String,
  vaccine_name:      String,
  cases:             Number,
  vaccinated:        Number,
  population:        Number,
  vaccination_rate:  Number,
  unvaccinated:      Number,
  vaccine_available: { type: String, default: "No" },   // "Yes" | "No" | "Partial"
  vaccine_need_score:             Number,
  vaccine_need_level:             String,
  herd_immunity_status:           String,
  infection_risk:                 Number,
  estimated_protected:            Number,
  doses_needed_for_herd_immunity: Number,
  risk:              String,   // ★ "HIGH" | "MEDIUM" | "LOW" — drives alert SMS
  uploadedAt:        { type: Date, default: Date.now },
});
const DatasetRow = mongoose.model("DatasetRow", datasetRowSchema);


/* ══════════════════════════════════════════════════════
   HELPER — Parse CSV Buffer (no external lib needed)
══════════════════════════════════════════════════════ */
function parseCSVBuffer(buffer) {
  const text  = buffer.toString("utf8");
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"')             { inQuote = !inQuote; continue; }
      if (ch === "," && !inQuote) { values.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    values.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ""; });
    return obj;
  });
}


/* ══════════════════════════════════════════════════════
   HELPER — Latest vaccine_available per region
══════════════════════════════════════════════════════ */
async function getRegionAvailability() {
  const latest = await DatasetRow.aggregate([
    { $sort: { date: -1 } },
    { $group: { _id: "$region", vaccine_available: { $first: "$vaccine_available" } } },
  ]);
  const result = {};
  for (const doc of latest) result[doc._id] = doc.vaccine_available || "No";
  return result;
}


/* ══════════════════════════════════════════════════════════════════
   ★ CORE HELPER — sendRiskAlerts()
   
   Called automatically after every dataset upload.
   For each region in the latest dataset:
     1. Gets the risk level (HIGH / MEDIUM / LOW) from the `risk` column
     2. Finds all users whose signup location matches that region
     3. Sends a tailored SMS to each user
     4. Saves an Alert document so the bell icon shows it in the UI
     5. Emits a real-time socket event to any connected user
══════════════════════════════════════════════════════════════════ */
async function sendRiskAlerts() {
  try {
    // ── Get the latest risk level per region from DatasetRow ──
    const latestPerRegion = await DatasetRow.aggregate([
      { $sort: { date: -1 } },
      {
        $group: {
          _id:               "$region",
          risk:              { $first: "$risk"              },
          cases:             { $first: "$cases"             },
          vaccination_rate:  { $first: "$vaccination_rate"  },
          vaccine_available: { $first: "$vaccine_available" },
          herd_immunity_status: { $first: "$herd_immunity_status" },
          infection_risk:    { $first: "$infection_risk"    },
        },
      },
    ]);

    if (!latestPerRegion.length) return;

    let totalSMS      = 0;
    let totalAlerts   = 0;
    let totalSockets  = 0;

    for (const regionDoc of latestPerRegion) {
      const region    = regionDoc._id;
      const riskRaw   = (regionDoc.risk || "LOW").toString().toUpperCase().trim();
      const riskLevel = ["HIGH", "MEDIUM", "LOW"].includes(riskRaw) ? riskRaw : "LOW";

      // ── Build the SMS message based on risk level ──
      const smsMessages = {
        HIGH: (region, cases, vaccRate) =>
          `🚨 HIGH RISK ALERT — ${region}\n` +
          `Active cases: ${cases?.toLocaleString() || "N/A"} | Vaccination rate: ${vaccRate ? vaccRate.toFixed(1) + "%" : "N/A"}\n` +
          `⚠️ URGENT: Avoid crowded places, wear N95 masks, isolate if symptomatic. ` +
          `Visit the PandemicAI portal to request a vaccine immediately. — PandemicAI`,

        MEDIUM: (region, cases, vaccRate) =>
          `⚠️ MEDIUM RISK ADVISORY — ${region}\n` +
          `Active cases: ${cases?.toLocaleString() || "N/A"} | Vaccination rate: ${vaccRate ? vaccRate.toFixed(1) + "%" : "N/A"}\n` +
          `Please wear masks in public spaces, maintain social distancing, ` +
          `and check the PandemicAI portal for vaccine availability. — PandemicAI`,

        LOW: (region, cases, vaccRate) =>
          `✅ LOW RISK — ${region}\n` +
          `Active cases: ${cases?.toLocaleString() || "N/A"} | Vaccination rate: ${vaccRate ? vaccRate.toFixed(1) + "%" : "N/A"}\n` +
          `Your region is currently at low risk. Continue basic hygiene practices ` +
          `and stay up to date on your vaccines. — PandemicAI`,
      };

      // ── Build the in-app alert message ──
      const alertMessages = {
        HIGH:   `🚨 HIGH RISK detected in ${region}. Cases: ${regionDoc.cases?.toLocaleString() || "N/A"}. Take immediate precautions — wear masks, avoid crowds, get vaccinated.`,
        MEDIUM: `⚠️ MEDIUM RISK in ${region}. Cases: ${regionDoc.cases?.toLocaleString() || "N/A"}. Stay alert, wear masks in public, check vaccine availability.`,
        LOW:    `✅ LOW RISK in ${region}. Cases: ${regionDoc.cases?.toLocaleString() || "N/A"}. Keep up safe practices and stay informed.`,
      };

      const smsText   = smsMessages[riskLevel](region, regionDoc.cases, regionDoc.vaccination_rate);
      const alertText = alertMessages[riskLevel];

      // ── Find all users whose location matches this region (case-insensitive) ──
      const usersInRegion = await User.find({
        role:      "user",
        isBlocked: false,
        location:  { $regex: new RegExp(`^${region.trim()}$`, "i") },
      });

      if (!usersInRegion.length) continue;

      for (const user of usersInRegion) {

        // 1. SMS notification
        if (user.phone) {
          try {
           
            totalSMS++;
          } catch (smsErr) {
            console.error(`SMS failed for ${user.username}:`, smsErr.message);
          }
        }

        // 2. Save in-app Alert document (shown in navbar bell icon)
        await Alert.create({
          location: region.toLowerCase().trim(),
          message:  alertText,
        });
        totalAlerts++;

        // 3. Real-time socket push to connected user
        if (typeof userSockets !== "undefined" && typeof io !== "undefined") {
          const socketId = userSockets[user.username];
          if (socketId) {
            io.to(socketId).emit("region-alert", {
              risk:    riskLevel,
              region,
              message: alertText,
            });
            totalSockets++;
          }
        }
      }

      console.log(`[RiskAlert] ${region} → ${riskLevel} | ${usersInRegion.length} user(s) processed`);
    }

    console.log(`[RiskAlert] Done — SMS: ${totalSMS}, Alerts saved: ${totalAlerts}, Socket pushes: ${totalSockets}`);
    return { totalSMS, totalAlerts, totalSockets };

  } catch (err) {
    console.error("[sendRiskAlerts] Error:", err.message);
  }
}


/* ══════════════════════════════════════════════════════
   DATASET UPLOAD  (admin only)
   POST /api/upload-dataset
   multipart/form-data  |  field name: "dataset"

   After saving rows → automatically calls sendRiskAlerts()
   so every user gets an SMS + in-app alert based on their
   signup location and the risk level in the dataset.
══════════════════════════════════════════════════════ */
app.post("/api/upload-dataset", uploadMiddleware.single("dataset"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const rows = parseCSVBuffer(req.file.buffer);
    if (!rows.length) return res.status(400).json({ message: "CSV is empty or unreadable" });

    let inserted = 0, updated = 0;

    for (const row of rows) {
      if (!row.region || !row.date) continue;

      const doc = {
        region:            row.region,
        date:              row.date,
        disease_name:      row.disease_name      || "",
        vaccine_name:      row.vaccine_name      || "",
        cases:             Number(row.cases)             || 0,
        vaccinated:        Number(row.vaccinated)        || 0,
        population:        Number(row.population)        || 0,
        vaccination_rate:  Number(row.vaccination_rate)  || 0,
        unvaccinated:      Number(row.unvaccinated)      || 0,
        vaccine_available: row.vaccine_available         || "No",
        vaccine_need_score:             Number(row.vaccine_need_score)             || 0,
        vaccine_need_level:             row.vaccine_need_level             || "",
        herd_immunity_status:           row.herd_immunity_status           || "",
        infection_risk:                 Number(row.infection_risk)                 || 0,
        estimated_protected:            Number(row.estimated_protected)            || 0,
        doses_needed_for_herd_immunity: Number(row.doses_needed_for_herd_immunity) || 0,
        risk:              (row.risk || "LOW").toUpperCase(), // ★ normalise to uppercase
        uploadedAt:        new Date(),
      };

      const existing = await DatasetRow.findOne({ region: doc.region, date: doc.date });
      if (existing) {
        await DatasetRow.updateOne({ _id: existing._id }, { $set: doc });
        updated++;
      } else {
        await DatasetRow.create(doc);
        inserted++;
      }
    }

    // ★ FIRE RISK ALERTS — SMS + in-app + socket for all users by location ★
    const alertStats = await sendRiskAlerts();

    // Also auto-notify any waitlisted vaccine users whose region is now "Yes"
    const avail = await getRegionAvailability();
    let vaccineNotified = 0;
    for (const [region, status] of Object.entries(avail)) {
      if (status !== "Yes") continue;
      const waitlisted = await VaccineRequest.find({ region, status: "waitlisted" });
      for (const r of waitlisted) {
        const u = await User.findOne({ username: r.username });
        if (u?.phone) {
        
        }
        r.status = "notified";
        await r.save();
        vaccineNotified++;
      }
    }

    res.json({
      message:
        `✅ Dataset uploaded — ${inserted} new row(s) added, ${updated} updated. ` +
        `Risk alerts sent via SMS to ${alertStats?.totalSMS || 0} user(s). ` +
        (vaccineNotified ? `${vaccineNotified} waitlisted vaccine user(s) also notified.` : ""),
      inserted,
      updated,
      total:           rows.length,
      riskSMSSent:     alertStats?.totalSMS     || 0,
      alertsSaved:     alertStats?.totalAlerts  || 0,
      socketsPushed:   alertStats?.totalSockets || 0,
      vaccineNotified,
    });

  } catch (err) {
    console.error("upload-dataset error:", err);
    res.status(500).json({ message: err.message });
  }
});


// GET /api/dataset-summary — admin dashboard overview
app.get("/api/dataset-summary", async (req, res) => {
  try {
    const avail     = await getRegionAvailability();
    const totalRows = await DatasetRow.countDocuments();

    // Also include risk per region for admin visibility
    const latestRisk = await DatasetRow.aggregate([
      { $sort: { date: -1 } },
      {
        $group: {
          _id:               "$region",
          vaccine_available: { $first: "$vaccine_available" },
          risk:              { $first: "$risk" },
        },
      },
    ]);

    const regions = latestRisk.map(d => ({
      region:            d._id,
      vaccine_available: d.vaccine_available || "No",
      risk:              d.risk || "LOW",
    }));

    res.json({ totalRows, regions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ══════════════════════════════════════════════════════
   VACCINE INVENTORY ROUTES
══════════════════════════════════════════════════════ */
app.get("/api/vaccine-inventory", async (req, res) => {
  try { res.json(await VaccineInventory.find().sort({ name: 1 })); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

app.post("/api/vaccine-inventory", async (req, res) => {
  try {
    const { name, stock } = req.body;
    if (await VaccineInventory.findOne({ name }))
      return res.status(400).json({ message: "Vaccine already exists" });
    const inv = await VaccineInventory.create({ name, stock: Number(stock) || 0 });
    res.json({ message: "Vaccine added", inv });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.put("/api/vaccine-inventory/:id", async (req, res) => {
  try {
    const newStock = Number(req.body.stock);
    const inv      = await VaccineInventory.findById(req.params.id);
    if (!inv) return res.status(404).json({ message: "Vaccine not found" });
    const wasOut = inv.stock === 0;
    inv.stock = newStock; inv.updatedAt = new Date(); await inv.save();
    if (wasOut && newStock > 0) {
      const wl = await VaccineRequest.find({ vaccine: inv.name, status: "waitlisted" });
      for (const r of wl) {
        const u = await User.findOne({ username: r.username });
        if (u?.phone) 
        r.status = "notified"; await r.save();
      }
      return res.json({ message: `Stock updated ✅ — ${wl.length} user(s) notified`, notified: wl.length });
    }
    res.json({ message: `Stock updated to ${newStock}` });
  } catch (err) { res.status(500).json({ message: err.message }); }
});


/* ══════════════════════════════════════════════════════
   REGIONAL AVAILABILITY
══════════════════════════════════════════════════════ */
app.get("/api/vaccine-availability", async (req, res) => {
  try { res.json(await getRegionAvailability()); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/vaccine-restock-region — admin manually restocks a region
app.post("/api/vaccine-restock-region", async (req, res) => {
  try {
    const { region, vaccine, newStatus = "Yes" } = req.body;
    if (!region) return res.status(400).json({ message: "Region is required" });

    const latest = await DatasetRow.findOne({ region }).sort({ date: -1 });
    if (!latest) return res.status(404).json({
      message: `No dataset rows found for "${region}". Upload the dataset first.`,
    });

    const today     = new Date().toISOString().split("T")[0];
    const latestObj = latest.toObject();
    delete latestObj._id;
    await DatasetRow.create({ ...latestObj, date: today, vaccine_available: newStatus, uploadedAt: new Date() });

    const wl = await VaccineRequest.find({ region, vaccine, status: "waitlisted" });
    let notified = 0;
    for (const r of wl) {
      const u = await User.findOne({ username: r.username });
      if (u?.phone) 
      r.status = "notified"; await r.save();
      notified++;
    }

    res.json({
      message: `✅ ${region} restocked to "${newStatus}" (${today}). ${notified} waitlisted user(s) notified via SMS.`,
      region, newStatus, notified,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});


/* ══════════════════════════════════════════════════════
   VACCINE REQUEST ROUTES
══════════════════════════════════════════════════════ */
app.post("/api/vaccine-request", async (req, res) => {
  try {
    const { username, vaccine, region, doses, notes } = req.body;
    if (!username || !vaccine || !region)
      return res.status(400).json({ message: "Username, vaccine and region are required" });

    const avail       = await getRegionAvailability();
    const regionAvail = avail[region] || "No";
    const user        = await User.findOne({ username });

    if (regionAvail === "Yes") {
      const inv = await VaccineInventory.findOne({ name: vaccine });
      if (inv && inv.stock >= Number(doses)) { inv.stock -= Number(doses); await inv.save(); }
      await VaccineRequest.create({ username, vaccine, region, doses, notes, status: "available" });
      if (user?.phone) 
      return res.json({
        availability: "Yes",
        message: `✅ Vaccine is available in ${region}! Your request for ${doses} dose(s) of "${vaccine}" has been confirmed. SMS sent.`,
      });

    } else if (regionAvail === "Partial") {
      await VaccineRequest.create({ username, vaccine, region, doses, notes, status: "partial" });
      
      return res.json({
        availability: "Partial",
        message: `⚠️ "${vaccine}" has partial availability in ${region}. Your request is logged and our team will confirm your doses soon. SMS sent.`,
      });

    } else {
      await VaccineRequest.create({ username, vaccine, region, doses, notes, status: "waitlisted" });
      if (user?.phone) 
      return res.json({
        availability: "No",
        message: `❌ "${vaccine}" is currently out of stock in ${region}. You've been added to the waitlist and will be notified via SMS once the admin restocks this region.`,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/vaccine-requests", async (req, res) => {
  try { res.json(await VaccineRequest.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

app.get("/api/vaccine-requests/user/:username", async (req, res) => {
  try { res.json(await VaccineRequest.find({ username: req.params.username }).sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ message: err.message }); }
});


/* ══════════════════════════════════════════════════════
   ALERT ROUTES (already in server.js — shown here for reference)
   These serve the Navbar bell icon. No changes needed if already present.
══════════════════════════════════════════════════════ */

// GET /api/alerts/:location — returns saved alerts for a user's location
// (Already in your server.js — keep it as-is)

// POST /api/send-alert — admin manual alert
// (Already in your server.js — keep it as-is)
