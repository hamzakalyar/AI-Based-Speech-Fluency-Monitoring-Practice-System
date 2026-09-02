/**
 * SESSION ROUTES — Audio Analysis & Session Management
 * =====================================================
 * These routes handle the core "Record → Analyze → View Results" flow.
 * 
 * FLOW:
 *   1. User uploads audio recording
 *   2. Express forwards audio to Python audio-service (/analyze)
 *   3. Python returns: transcript, stutter metrics, NLP analysis, weak sounds
 *   4. Express saves everything to MongoDB (Session model)
 *   5. Express returns the results to the client
 * 
 * ENDPOINTS:
 *   POST /api/sessions/analyze      → Upload audio & run full AI analysis
 *   GET  /api/sessions              → Get all sessions for current user
 *   GET  /api/sessions/:id          → Get a specific session with full details
 *   GET  /api/sessions/stats/summary → Get user's overall progress summary
 *   DELETE /api/sessions/:id        → Delete a session
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const Session = require('../models/Session');
const User = require('../models/User');

const router = express.Router();

// Python audio-service URL (from .env)
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';


/**
 * POST /api/sessions/analyze
 * 
 * The main endpoint — upload audio and get full AI analysis.
 * 
 * Headers: Authorization: Bearer <token>
 * Body:    multipart/form-data with 'audio' file field
 * 
 * Returns: Complete session object with transcript, metrics, NLP, weak sounds
 */
router.post('/analyze', auth, upload.single('audio'), async (req, res) => {
  let savedFilePath = null;

  try {
    // Validate that a file was uploaded
    if (!req.file) {
      return res.status(400).json({ message: 'No audio file provided. Send a file in the "audio" field.' });
    }

    savedFilePath = req.file.path;
    console.log(`\n📂 Audio received from user ${req.user.name}: ${req.file.filename}`);

    // ============================================
    // STEP 1: Create a pending session in MongoDB
    // ============================================
    const session = new Session({
      user: req.user._id,
      audioPath: req.file.path,
      audioFilename: req.file.filename,
      status: 'processing'
    });
    await session.save();
    console.log(`📝 Session created: ${session._id}`);

    // ============================================
    // STEP 2: Forward audio to Python service
    // ============================================
    console.log(`🔄 Sending audio to Python service at ${PYTHON_SERVICE_URL}/analyze...`);

    // Build a multipart form to send the audio file to Python
    const formData = new FormData();
    formData.append('audio', fs.createReadStream(savedFilePath), {
      filename: req.file.filename,
      contentType: req.file.mimetype
    });

    // Forward passageId and expectedText if provided (assessment mode)
    if (req.body?.passageId) {
      formData.append('passageId', req.body.passageId);
      console.log(`📋 Assessment mode: passage '${req.body.passageId}'`);
    }
    if (req.body?.expectedText) {
      formData.append('expectedText', req.body.expectedText);
    }

    const pythonResponse = await axios.post(
      `${PYTHON_SERVICE_URL}/analyze`,
      formData,
      {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 120000  // 2 minute timeout (Whisper can be slow)
      }
    );

    const analysis = pythonResponse.data;
    console.log(`✅ Python service returned. Fluency Score: ${analysis.metrics?.fluencyScore}/100`);

    // ============================================
    // STEP 3: Save analysis results to MongoDB
    // ============================================
    session.status = 'completed';
    session.audioUrl = `/uploads/${req.file.filename}`;
    session.duration = analysis.duration || 0;
    session.transcript = {
      text: analysis.transcript?.text || '',
      words: analysis.transcript?.words || []
    };
    session.metrics = {
      fluencyScore: analysis.metrics?.fluencyScore || 0,
      speechRateWPM: analysis.metrics?.speechRateWPM || 0,
      repetitionCount: analysis.metrics?.repetitionCount || 0,
      pauseCount: analysis.metrics?.pauseCount || 0,
      fillerCount: analysis.metrics?.fillerCount || 0,
      repetitions: analysis.metrics?.repetitions || [],
      pauses: analysis.metrics?.pauses || [],
      fillers: analysis.metrics?.fillers || [],
      detectedStutters: analysis.metrics?.detectedStutters || []
    };
    session.nlpAnalysis = {
      posDistribution: analysis.nlpAnalysis?.posDistribution || {},
      complexity: analysis.nlpAnalysis?.complexity || {},
      avoidanceDetected: analysis.nlpAnalysis?.avoidanceDetected || false,
      sentimentPolarity: analysis.nlpAnalysis?.sentimentPolarity || 0
    };
    session.weakSoundsDetected = analysis.weakSoundsDetected || [];

    // Save assessment comparison if present
    if (analysis.assessmentComparison) {
      session.assessmentComparison = analysis.assessmentComparison;
    }
    if (req.body?.passageId) {
      session.passageId = req.body.passageId;
    }

    await session.save();
    console.log(`💾 Session ${session._id} saved to MongoDB`);

    // ============================================
    // STEP 4: Update user's aggregate stats
    // ============================================
    const userSessions = await Session.find({
      user: req.user._id,
      status: 'completed'
    }).select('metrics.fluencyScore');

    const totalSessions = userSessions.length;
    const avgScore = totalSessions > 0
      ? Math.round(userSessions.reduce((sum, s) => sum + (s.metrics?.fluencyScore || 0), 0) / totalSessions)
      : 0;

    // Aggregate weak sounds across all sessions
    const weakSoundsMap = {};
    const allSessions = await Session.find({
      user: req.user._id,
      status: 'completed'
    }).select('weakSoundsDetected');

    for (const s of allSessions) {
      for (const ws of (s.weakSoundsDetected || [])) {
        if (weakSoundsMap[ws.sound]) {
          weakSoundsMap[ws.sound] += ws.frequency || 1;
        } else {
          weakSoundsMap[ws.sound] = ws.frequency || 1;
        }
      }
    }

    const weakSoundsArray = Object.entries(weakSoundsMap)
      .map(([sound, frequency]) => ({ sound, frequency, trend: 'stable' }))
      .sort((a, b) => b.frequency - a.frequency);

    await User.findByIdAndUpdate(req.user._id, {
      totalSessions,
      averageFluencyScore: avgScore,
      weakSounds: weakSoundsArray
    });

    console.log(`📊 User stats updated: ${totalSessions} sessions, avg score: ${avgScore}`);

    // ============================================
    // STEP 5: Return the complete result
    // ============================================
    res.status(201).json({
      message: 'Audio analysis completed successfully',
      session
    });

  } catch (error) {
    console.error(`\n❌ Analysis error:`, error.message);

    // If we created a session, mark it as failed
    if (error.sessionId) {
      await Session.findByIdAndUpdate(error.sessionId, { status: 'failed' });
    }

    // Check if it's a Python service connection error
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        message: 'Audio analysis service is not running. Please start the Python service on port 5000.',
        error: 'PYTHON_SERVICE_UNAVAILABLE'
      });
    }

    if (error.response?.data) {
      return res.status(502).json({
        message: 'Audio analysis service returned an error',
        error: error.response.data
      });
    }

    res.status(500).json({
      message: 'Failed to analyze audio',
      error: error.message
    });
  } finally {
    // We NO LONGER delete the file here because we need it for later playback in session details.
    // The uploads are served statically by Express at /uploads
    console.log(`🎬 Analysis process finished for ${savedFilePath}`);
  }
});


/**
 * GET /api/sessions
 * 
 * Get all sessions for the current user, sorted by newest first.
 * Returns a summary (no full transcript/word data to keep it light).
 */
router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const sessions = await Session.find({ user: req.user._id })
      .select('status duration metrics.fluencyScore metrics.speechRateWPM metrics.repetitionCount metrics.pauseCount metrics.fillerCount weakSoundsDetected createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Session.countDocuments({ user: req.user._id });

    res.json({
      sessions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch sessions', error: error.message });
  }
});


/**
 * GET /api/sessions/stats/summary
 * 
 * Get an overall progress summary for the current user.
 * Includes average score, total sessions, improvement trend, top weak sounds.
 */
router.get('/stats/summary', auth, async (req, res) => {
  try {
    const sessions = await Session.find({
      user: req.user._id,
      status: 'completed'
    })
      .select('metrics.fluencyScore metrics.speechRateWPM metrics.repetitionCount metrics.pauseCount metrics.fillerCount weakSoundsDetected createdAt')
      .sort({ createdAt: -1 });

    if (sessions.length === 0) {
      return res.json({
        totalSessions: 0,
        averageFluencyScore: 0,
        latestFluencyScore: 0,
        improvementTrend: 'no_data',
        topWeakSounds: [],
        recentSessions: []
      });
    }

    const avgScore = Math.round(
      sessions.reduce((sum, s) => sum + (s.metrics?.fluencyScore || 0), 0) / sessions.length
    );

    // Improvement trend: compare last 3 sessions to the 3 before that
    let improvementTrend = 'stable';
    if (sessions.length >= 6) {
      const recent3 = sessions.slice(0, 3).reduce((sum, s) => sum + (s.metrics?.fluencyScore || 0), 0) / 3;
      const older3 = sessions.slice(3, 6).reduce((sum, s) => sum + (s.metrics?.fluencyScore || 0), 0) / 3;
      if (recent3 > older3 + 3) improvementTrend = 'improving';
      else if (recent3 < older3 - 3) improvementTrend = 'declining';
    }

    // Aggregate weak sounds
    const weakSoundsMap = {};
    for (const s of sessions) {
      for (const ws of (s.weakSoundsDetected || [])) {
        weakSoundsMap[ws.sound] = (weakSoundsMap[ws.sound] || 0) + (ws.frequency || 1);
      }
    }
    const topWeakSounds = Object.entries(weakSoundsMap)
      .map(([sound, frequency]) => ({ sound, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);

    // Calculate specific trends for dashboard cards
    const trends = {
      sessions: sessions.length > 0 ? sessions.length : 0,
      wpm: 0,
      repetitions: 0
    };

    if (sessions.length >= 2) {
      // Compare latest session vs previous or average of recent vs older
      const recentCount = Math.min(3, Math.ceil(sessions.length / 2));
      const recentSessions = sessions.slice(0, recentCount);
      const olderSessions = sessions.slice(recentCount, recentCount * 2);

      if (olderSessions.length > 0) {
        const recentWpm = recentSessions.reduce((sum, s) => sum + (s.metrics?.speechRateWPM || 0), 0) / recentSessions.length;
        const olderWpm = olderSessions.reduce((sum, s) => sum + (s.metrics?.speechRateWPM || 0), 0) / olderSessions.length;
        if (olderWpm > 0) trends.wpm = Math.round(((recentWpm - olderWpm) / olderWpm) * 100);

        const recentRep = recentSessions.reduce((sum, s) => sum + (s.metrics?.repetitionCount || 0), 0) / recentSessions.length;
        const olderRep = olderSessions.reduce((sum, s) => sum + (s.metrics?.repetitionCount || 0), 0) / olderSessions.length;
        if (olderRep > 0) trends.repetitions = Math.round(((recentRep - olderRep) / olderRep) * 100);
      }
    }

    res.json({
      totalSessions: sessions.length,
      averageFluencyScore: avgScore,
      latestFluencyScore: sessions[0]?.metrics?.fluencyScore || 0,
      improvementTrend,
      trends,
      topWeakSounds,
      recentSessions: sessions.slice(0, 5).map(s => ({
        id: s._id,
        fluencyScore: s.metrics?.fluencyScore || 0,
        speechRateWPM: s.metrics?.speechRateWPM || 0,
        date: s.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch stats', error: error.message });
  }
});


/**
 * GET /api/sessions/:id
 * 
 * Get a specific session with ALL details (transcript, metrics, NLP, etc.).
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const session = await Session.findOne({
      _id: req.params.id,
      user: req.user._id  // Ensure user can only access their own sessions
    });

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    res.json({ session });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid session ID' });
    }
    res.status(500).json({ message: 'Failed to fetch session', error: error.message });
  }
});


/**
 * DELETE /api/sessions/:id
 * 
 * Delete a specific session.
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const session = await Session.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id
    });

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // Update user stats after deletion
    const remaining = await Session.find({
      user: req.user._id,
      status: 'completed'
    }).select('metrics.fluencyScore');

    const totalSessions = remaining.length;
    const avgScore = totalSessions > 0
      ? Math.round(remaining.reduce((sum, s) => sum + (s.metrics?.fluencyScore || 0), 0) / totalSessions)
      : 0;

    await User.findByIdAndUpdate(req.user._id, {
      totalSessions,
      averageFluencyScore: avgScore
    });

    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid session ID' });
    }
    res.status(500).json({ message: 'Failed to delete session', error: error.message });
  }
});


// Export both routers together — module.exports = router (line below)
// was previously being OVERWRITTEN by module.exports.assessmentRouter further down.
// Fix: use named exports for both so app.js can destructure cleanly.
module.exports = { sessionRouter: router };


/**
 * ASSESSMENT PASSAGE PROXY ROUTES
 * Forward requests to the Python audio-service
 */
const assessmentRouter = express.Router();

// Load built-in assessment passages as resilient fallback
let builtinPassages = { passages: [], passagesMap: {} };
try {
  builtinPassages = require('../data/passages.json');
} catch (e) {
  console.warn('⚠️  Built-in passages.json not loaded:', e.message);
}

// GET /api/assessment-passages — List all passages
assessmentRouter.get('/', async (req, res) => {
  try {
    const response = await axios.get(`${PYTHON_SERVICE_URL}/assessment-passages`, { timeout: 3000 });
    if (response.data && response.data.passages && response.data.passages.length > 0) {
      return res.json(response.data);
    }
  } catch (error) {
    // Python service is down or cold-starting — fall back to built-in clinical passages
  }
  return res.json({ passages: builtinPassages.passages || [] });
});

// GET /api/assessment-passages/:id — Get specific passage
assessmentRouter.get('/:id', async (req, res) => {
  try {
    const url = new URL(`${PYTHON_SERVICE_URL}/assessment-passages/${req.params.id}`);
    if (req.query) {
      Object.keys(req.query).forEach(key => url.searchParams.append(key, req.query[key]));
    }
    const response = await axios.get(url.toString(), { timeout: 3000 });
    if (response.data) {
      return res.json(response.data);
    }
  } catch (error) {
    // Fall back to built-in passage data
  }

  const pid = req.params.id;
  const passage = builtinPassages.passagesMap?.[pid] || builtinPassages.passages?.find(p => p.id === pid);
  if (passage) {
    return res.json({ passage });
  }
  return res.status(404).json({ message: 'Passage not found' });
});

module.exports.assessmentRouter = assessmentRouter;
