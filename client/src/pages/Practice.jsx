import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { 
  Trophy, Target, Zap, Mic, CheckCircle2, 
  RotateCcw, Play, Pause, ChevronRight, Info, 
  TrendingUp, ArrowRight, Square, Loader2, Sparkles, Undo2, PartyPopper
} from 'lucide-react';
import { sessionsService } from '../services/sessionsService';
import { analyticsService } from '../services/analyticsService';
import { practiceService } from '../services/practiceService';
import { useRecording } from '../hooks/useRecording';
import Badge from '../components/shared/Badge';
import Breadcrumb from '../components/layout/Breadcrumb';
import Card from '../components/shared/Card';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils/cn';
import WaveformCanvas from '../components/features/Recording/WaveformCanvas';

const ProgressCheckCard = ({ targetSound, onComplete }) => {
  const passageMap = {
    'S': 'fricatives_s', 'SH': 'fricatives_s',
    'TH': 'fricatives_th', 'DH': 'fricatives_th',
    'B': 'plosives_bp', 'P': 'plosives_bp',
    'T': 'plosives_td', 'D': 'plosives_td',
    'K': 'plosives_kg', 'G': 'plosives_kg',
    'F': 'fricatives_f', 'V': 'fricatives_f',
    'R': 'liquids_rl', 'L': 'liquids_rl',
    'STR': 'clusters', 'SP': 'clusters'
  };
  const initialPassageId = passageMap[targetSound?.toUpperCase()] || 'screening';
  const [passage, setPassage] = useState(null);
  const [comparison, setComparison] = useState(null);
  const { status, duration, startRecording, stopRecording, startAnalysis, analysisResults, resetRecording } = useRecording();

  useEffect(() => {
    const passageId = passageMap[targetSound?.toUpperCase()] || 'screening';
    sessionsService.getPassageById(passageId)
      .then(res => {
        if (res?.data?.passage) setPassage(res.data.passage);
      })
      .catch(err => {
        console.error("Failed to load verification passage", err);
      });
  }, [targetSound]);

  useEffect(() => {
    if (status === 'success' && analysisResults) {
      const newScore = analysisResults.fluencyScore || analysisResults.metrics?.fluencyScore || 0;
      analyticsService.getSummary()
        .then(res => {
          const baseline = res?.data?.averageFluencyScore || 60;
          setComparison({ current: newScore, previous: baseline, improvement: newScore - baseline });
        })
        .catch(err => {
          console.error("Baseline sync failed", err);
          setComparison({ current: newScore, previous: 60, improvement: 0 });
        });
    }
  }, [status, analysisResults]);

  if (!passage) return null;

  return (
    <Card className="border-2 border-[var(--accent)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--accent)]/5 overflow-hidden relative p-8">
      <div className="absolute top-0 right-0 p-4 opacity-10"><TrendingUp size={120} /></div>
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent)] text-white flex items-center justify-center shadow-lg"><Trophy size={20} /></div>
          <div>
            <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight">Progress Verification</h3>
            <p className="text-xs font-bold text-[var(--accent)] uppercase tracking-widest">Challenge: Master your {targetSound} sounds</p>
          </div>
        </div>
        {!comparison ? (
          <div className="space-y-6">
            <div className="p-6 bg-[var(--bg-base)] rounded-2xl border border-[var(--border-subtle)] shadow-inner">
              <p className="text-lg font-medium text-[var(--text-secondary)] italic leading-relaxed text-center">"{passage.text}"</p>
            </div>
            <div className="flex flex-col items-center gap-4">
              {status === 'idle' ? (
                <button onClick={startRecording} className="w-16 h-16 rounded-full bg-[var(--accent)] text-white flex items-center justify-center shadow-xl hover:scale-110 transition-all"><Mic size={28} /></button>
              ) : status === 'recording' ? (
                <button onClick={stopRecording} className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-xl animate-pulse"><Square size={24} fill="currentColor" /></button>
              ) : status === 'reviewing' ? (
                <div className="flex gap-4 w-full max-w-xs">
                   <button onClick={resetRecording} className="flex-1 h-12 rounded-xl border-2 border-[var(--border-subtle)] text-[var(--text-muted)] font-black text-xs uppercase tracking-widest">Retake</button>
                   <button onClick={() => startAnalysis(passage.id)} className="flex-[2] h-12 rounded-xl bg-[var(--accent-navy)] text-white font-black text-xs uppercase tracking-widest shadow-lg">Verify Progress</button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2"><Loader2 className="animate-spin text-[var(--accent)]" /><span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em]">Analyzing...</span></div>
              )}
            </div>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4">
            <div className="flex justify-center gap-8 mb-8">
              <div className="text-center"><p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1">Previous Baseline</p><p className="text-3xl font-black text-[var(--text-secondary)]">{comparison.previous}%</p></div>
              <div className="w-[1px] h-12 bg-[var(--border-subtle)] mt-2" />
              <div className="text-center"><p className="text-[10px] font-black text-[var(--accent)] uppercase tracking-widest mb-1">New Score</p><p className="text-3xl font-black text-[var(--text-primary)]">{comparison.current}%</p></div>
            </div>
            <button onClick={() => onComplete()} className="px-8 py-3 bg-[var(--accent-navy)] text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[var(--accent)] transition-all shadow-lg flex items-center gap-2 mx-auto">Finish Daily Practice <ArrowRight size={16} /></button>
          </motion.div>
        )}
      </div>
    </Card>
  );
};

// ── Pronunciation Hints per sound ────────────────────────────────────────────
const PRONUNCIATION_HINTS = {
  S:  'Keep your tongue behind your teeth. Air flows over the center.',
  SH: 'Round your lips slightly. Tongue tip near the roof of your mouth.',
  TH: 'Place your tongue gently between your teeth and push air through.',
  DH: 'Same as TH but vibrate your vocal cords.',
  B:  'Press both lips together, then release with a burst of air.',
  P:  'Like B but without vocal cords — a clean pop of air.',
  T:  'Tongue tip touches the ridge behind your top teeth, then releases.',
  D:  'Like T but voiced — your vocal cords should buzz.',
  K:  'Back of your tongue touches the soft palate at the back.',
  G:  'Like K but vibrate your throat.',
  F:  'Upper teeth lightly touch your lower lip, blow steady air.',
  V:  'Like F but vibrate your vocal cords.',
  R:  'Curl your tongue back without touching the roof.',
  L:  'Tongue tip touches the ridge behind your top teeth.',
  STR:'Blend S→T→R smoothly: ssss-t-rrr without stopping.',
  SP: 'S then P in one breath — no gap between them.',
};

// ── Highlight target sound in sentence ───────────────────────────────────────
function HighlightedSentence({ text, sound }) {
  if (!sound || !text) return <span>{text}</span>;
  const regex = new RegExp(`(${sound})`, 'gi');
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part)
          ? <mark key={i} className="bg-teal-400/20 text-teal-700 font-black rounded px-0.5 not-italic">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </span>
  );
}

const ExerciseCard = ({ exercise, onComplete, isInitiallyCompleted, isActive, onActivate }) => {
  const { status, duration, audioBlob, startRecording, stopRecording, startAnalysis, analysisResults, resetRecording, analyser } = useRecording();
  const [isCompleted, setIsCompleted] = useState(isInitiallyCompleted || false);
  const [score, setScore] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [recordingTimer, setRecordingTimer] = useState(0);
  const timerRef = useRef(null);
  const audioRef = useRef(null);

  // ── HCI: Spacebar shortcut to record/stop (only for the active card) ──
  useEffect(() => {
    if (!isActive || isCompleted) return;
    const handleKey = (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        if (status === 'recording') stopRecording();
        else if (status === 'idle') startRecording();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isActive, isCompleted, status]);

  // Live recording timer
  useEffect(() => {
    if (status === 'recording') {
      setRecordingTimer(0);
      timerRef.current = setInterval(() => setRecordingTimer(t => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  useEffect(() => {
    if (status === 'success' && analysisResults && !isCompleted) {
      const fluencyScore = analysisResults.fluencyScore || analysisResults.metrics?.fluencyScore || 0;
      setScore(fluencyScore);
      setIsCompleted(true);
      practiceService.saveResult({
        targetSound: exercise.tag,
        targetSentence: exercise.text,
        exerciseType: 'sentence',
        difficulty: exercise.difficulty.toLowerCase(),
        score: fluencyScore
      }).catch(err => console.error("Failed to save result:", err));
      onComplete(exercise.id);
    }
  }, [status, analysisResults]);

  const isRecording = status === 'recording' || status === 'permissions';
  const hint = PRONUNCIATION_HINTS[exercise.tag?.toUpperCase()];
  const scoreColor = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-400' : 'bg-rose-400';
  const scoreLabel = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : 'Keep Practicing';

  return (
    <div className={cn(
      "relative rounded-2xl border transition-all duration-300 overflow-hidden",
      isCompleted
        ? "bg-[var(--accent)]/[0.03] border-[var(--accent)]/20"
        : "bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--accent)]/30 hover:shadow-md"
    )}>
      {/* ── Top Row: Info ── */}
      <div className="flex items-center gap-4 px-5 pt-3 pb-2">

        {/* Number / Done Badge */}
        <div className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 border transition-all",
          isCompleted ? "bg-teal-600 text-white border-teal-600" : "bg-[var(--bg-base)] text-[var(--text-primary)] border-[var(--border-subtle)]"
        )}>
          {isCompleted ? <CheckCircle2 size={17} strokeWidth={3} /> : `${String(exercise.num).padStart(2,'0')}`}
        </div>

        {/* Title + badges + sentence */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-base font-black font-syne tracking-tight text-[var(--text-primary)] truncate">{exercise.title}</h4>
            <Badge variant="slate" size="sm">{exercise.tag}</Badge>
            <Badge size="sm" variant={exercise.difficulty?.toLowerCase() === 'easy' ? 'success' : 'warning'}>{exercise.difficulty}</Badge>
          </div>
          <p className="text-sm font-medium italic text-[var(--text-secondary)] mt-1 leading-snug line-clamp-1">
            "<HighlightedSentence text={exercise.text} sound={exercise.tag} />"
          </p>
        </div>

        {/* Hint toggle (top right) */}
        {hint && (
          <button
            onClick={() => setShowHint(v => !v)}
            aria-label={showHint ? 'Hide pronunciation tip' : 'Show pronunciation tip'}
            title="Pronunciation tip (HCI: contextual help)"
            className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center transition-all border shrink-0",
              showHint
                ? "bg-amber-400/10 border-amber-400/30 text-amber-500"
                : "bg-[var(--bg-base)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-amber-500"
            )}
          >
            <Info size={14} />
          </button>
        )}
      </div>

      {/* ── Bottom Row: Actions ── */}
      <div className="flex items-center gap-3 px-5 pb-3">

        {/* Record / Stop / Play button — aria-label for accessibility */}
        <button
          onClick={() => {
            onActivate?.();
            if (status === 'recording') stopRecording();
            else if (status === 'reviewing') {
              if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
              else {
                const url = URL.createObjectURL(audioBlob);
                // Pause any previous instance first
                if (audioRef.current) {
                  audioRef.current.pause();
                  audioRef.current = null;
                }
                const a = new Audio(url);
                a.load(); // must call load() before play() on dynamically created Audio
                audioRef.current = a;
                a.play().catch(e => console.warn('ExerciseCard playback failed:', e));
                setIsPlaying(true);
                a.onended = () => setIsPlaying(false);
              }
            } else startRecording();
          }}
          disabled={isCompleted}
          aria-label={
            isRecording ? 'Stop recording' :
            status === 'reviewing' ? (isPlaying ? 'Pause playback' : 'Play recording') :
            `Record exercise ${exercise.num} — press Space to toggle`
          }
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-all shadow-md shrink-0",
            isRecording ? "bg-red-500 text-white animate-pulse" :
            status === 'reviewing' ? "bg-[var(--accent)] text-white hover:scale-105" :
            "bg-[var(--accent)] text-white hover:scale-105",
            isCompleted && "bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed opacity-50"
          )}
        >
          {isRecording ? <Square size={16} fill="currentColor" /> :
           status === 'reviewing' ? (isPlaying ? <Pause size={16} /> : <Play size={16} fill="currentColor" />) :
           <Mic size={16} />}
        </button>

        {/* Re-record — aria-label for accessibility */}
        {status === 'reviewing' && !isCompleted && (
          <button
            onClick={resetRecording}
            aria-label="Re-record this exercise"
            className="w-9 h-9 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:text-amber-500 transition-all"
            title="Re-record"
          >
            <RotateCcw size={15} />
          </button>
        )}

        {/* Live waveform + timer */}
        {status === 'recording' && (
          <>
            <div className="flex-1 h-9 bg-[var(--bg-base)] rounded-xl border border-[var(--border-subtle)] overflow-hidden px-3 flex items-center">
              <WaveformCanvas analyser={analyser} isRecording={true} color="var(--accent)" bars={28} />
            </div>
            <span className="text-[11px] font-black text-red-500 tabular-nums shrink-0">
              {String(Math.floor(recordingTimer / 60)).padStart(2,'0')}:{String(recordingTimer % 60).padStart(2,'0')}
            </span>
          </>
        )}

        {/* Spacer when not recording */}
        {status !== 'recording' && <div className="flex-1" />}

        {/* Analyze button — aria-label for accessibility */}
        {!isCompleted && (
          <button
            onClick={() => startAnalysis(null, exercise.text)}
            disabled={status !== 'reviewing'}
            aria-label="Analyze recorded speech"
            className={cn(
              "h-8 px-5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap",
              status === 'reviewing'
                ? "bg-[var(--accent-navy)] text-white shadow-sm hover:bg-[var(--accent)]"
                : "bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed opacity-50"
            )}
          >
            {status === 'analysing' ? <Loader2 size={13} className="animate-spin inline" /> : <>Analyze Speech <ChevronRight size={13} className="inline ml-1" /></>}
          </button>
        )}
      </div>




      {/* ── Score Bar (on completion) ── */}
      {isCompleted && score !== null && (
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">{scoreLabel}</span>
            <span className="text-[11px] font-black text-[var(--text-primary)]">{score}/100</span>
          </div>
          <div className="h-1.5 bg-[var(--bg-base)] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${score}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className={`h-full rounded-full ${scoreColor}`}
            />
          </div>
        </div>
      )}

      {/* ── Pronunciation Hint Panel ── */}
      <AnimatePresence>
        {showHint && hint && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-amber-400/20"
          >
            <div className="px-5 py-3 bg-amber-400/5 flex items-start gap-2">
              <Info size={13} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[12px] font-medium text-amber-700 leading-snug">{hint}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Practice = () => {
  const location = useLocation();
  const preselectedSound = location.state?.targetSound; // e.g. 'TH', 'P', 'B'

  const [completedIds, setCompletedIds] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [difficulty, setDifficulty] = useState('medium');
  const [loading, setLoading] = useState(true);
  const [soundProgress, setSoundProgress] = useState([]);
  const [topWeakSound, setTopWeakSound] = useState(null);
  const [userWeakSounds, setUserWeakSounds] = useState([]);
  const [noWeakSounds, setNoWeakSounds] = useState(false);
  // HCI: Undo stack & active card tracking & celebration
  const [undoStack, setUndoStack] = useState([]);
  const [activeCardId, setActiveCardId] = useState(null);
  const [showCelebration, setShowCelebration] = useState(false);

  const MOCK_EXERCISES = [
    {
      id: 'ex-mock-1',
      num: 1,
      title: "Plosive Pressure Reduction",
      text: "Please prepare the perfect presentation on Tuesday.",
      tag: "P",
      difficulty: "Easy"
    },
    {
      id: 'ex-mock-2',
      num: 2,
      title: "Voiced Bilabial Soft Murmur",
      text: "Big brown bears build beautiful blue barriers.",
      tag: "B",
      difficulty: "Medium"
    },
    {
      id: 'ex-mock-3',
      num: 3,
      title: "Complex Tri-Consonant Release",
      text: "Try to speak clearly and breathe smoothly through the struggle.",
      tag: "STR",
      difficulty: "Hard"
    }
  ];

  const MOCK_SOUND_PROGRESS = [
    {
      sound: "/p/",
      averageScore: 84,
      bestScore: 92,
      totalAttempts: 8,
      lastAttempt: new Date().toISOString()
    },
    {
      sound: "/b/",
      averageScore: 78,
      bestScore: 86,
      totalAttempts: 5,
      lastAttempt: new Date().toISOString()
    },
    {
      sound: "/str/",
      averageScore: 62,
      bestScore: 74,
      totalAttempts: 3,
      lastAttempt: new Date().toISOString()
    }
  ];

  const loadPracticeData = async () => {
    setLoading(true);
    setNoWeakSounds(false);

    const isDemo = localStorage.getItem('is_demo_mode') === 'true';
    if (isDemo) {
      const activeSound = preselectedSound || 'TH';
      setUserWeakSounds([activeSound, 'P', 'B']);
      setTopWeakSound(activeSound);
      
      // Dynamically assemble targeted custom drills for the active weak sound
      let generatedDemo = [];
      if (activeSound === 'TH') {
        generatedDemo = [
          {
            id: 'ex-th-1',
            num: 1,
            title: "Dental Fricative Easy Onset",
            text: "Think through the therapeutic tongue twisters thoroughly.",
            tag: "TH",
            difficulty: "Easy"
          },
          {
            id: 'ex-th-2',
            num: 2,
            title: "Soft Contact Continuant Voicing",
            text: "These thin thistles thorn those thirsty thieves.",
            tag: "TH",
            difficulty: "Medium"
          },
          {
            id: 'ex-th-3',
            num: 3,
            title: "Phonetic Glide Cohesion",
            text: "There they go together, thriving through the storm.",
            tag: "TH",
            difficulty: "Hard"
          }
        ];
      } else if (activeSound === 'P') {
        generatedDemo = [
          {
            id: 'ex-p-1',
            num: 1,
            title: "Plosive Pressure Reduction",
            text: "Please prepare the perfect presentation on Tuesday.",
            tag: "P",
            difficulty: "Easy"
          },
          {
            id: 'ex-p-2',
            num: 2,
            title: "Light Contacts Onset",
            text: "Peter Piper picked a peck of pickled peppers.",
            tag: "P",
            difficulty: "Medium"
          },
          {
            id: 'ex-p-3',
            num: 3,
            title: "Continuous Airflow Integration",
            text: "Purple paper plates push people toward perfect pacing.",
            tag: "P",
            difficulty: "Hard"
          }
        ];
      } else if (activeSound === 'B') {
        generatedDemo = [
          {
            id: 'ex-b-1',
            num: 1,
            title: "Voiced Bilabial Soft Murmur",
            text: "Big brown bears build beautiful blue barriers.",
            tag: "B",
            difficulty: "Easy"
          },
          {
            id: 'ex-b-2',
            num: 2,
            title: "Co-articulation Transition",
            text: "Baker boys blow bright bubbles behind the barn.",
            tag: "B",
            difficulty: "Medium"
          },
          {
            id: 'ex-b-3',
            num: 3,
            title: "Voicing Continuity Velocity",
            text: "Brave brothers bring bright books back to Boston.",
            tag: "B",
            difficulty: "Hard"
          }
        ];
      } else {
        generatedDemo = [
          {
            id: 'ex-gen-1',
            num: 1,
            title: `Custom ${activeSound} Drill`,
            text: `Sally sings sweet songs on sunny summer Sundays.`,
            tag: activeSound,
            difficulty: "Medium"
          }
        ];
      }
      setExercises(generatedDemo);
      
      const mergedProgress = MOCK_SOUND_PROGRESS.map((sp, idx) => ({
        id: `mastery-${sp.sound}-${idx}`,
        sound: sp.sound,
        averageScore: sp.averageScore,
        bestScore: sp.bestScore,
        totalAttempts: sp.totalAttempts,
        lastAttempt: sp.lastAttempt
      }));
      setSoundProgress(mergedProgress);
      setLoading(false);
      return;
    }

    try {
      // Step 1: Get user's detected weak sounds from analytics (recordings)
      const summaryRes = await analyticsService.getSummary().catch(() => ({ data: {} }));
      const detectedWeakSounds = preselectedSound ? [preselectedSound] : (summaryRes?.data?.topWeakSounds || [])
        .map(ws => ws?.sound)
        .filter(Boolean);
      
      setUserWeakSounds(detectedWeakSounds);

      if (detectedWeakSounds.length === 0) {
        console.log('No weak sounds in profile — server will use fallback');
      }

      if (detectedWeakSounds.length > 0) setTopWeakSound(detectedWeakSounds[0]);

      // Step 2: Generate exercises targeting those exact weak sounds
      const [exercisesRes, progressRes, todayResultsRes] = await Promise.all([
        practiceService.generateExercises(difficulty, detectedWeakSounds).catch(() => ({ data: { exercises: [] } })),
        practiceService.getSoundProgress().catch(() => ({ data: { soundProgress: [] } })),
        practiceService.getResults({ limit: 50 }).catch(() => ({ data: { results: [] } }))
      ]);

      const rawExercises = exercisesRes?.data?.exercises || [];

      // NORMALISE: Python returns { sentence, targetSound, soundLabel, difficulty }
      // but ExerciseCard reads { text, tag, title, num, id, difficulty }
      const exerciseList = rawExercises.map((ex, idx) => ({
        id:         ex.id         || `ex-${idx}`,
        num:        idx + 1,
        title:      ex.title      || ex.soundLabel || `${ex.targetSound || ex.tag || 'Sound'} Exercise`,
        text:       ex.text       || ex.sentence   || '',
        tag:        ex.tag        || ex.targetSound || '',
        difficulty: ex.difficulty
          ? ex.difficulty.charAt(0).toUpperCase() + ex.difficulty.slice(1)
          : 'Easy',
      }));
      setExercises(exerciseList);

      // Step 3: Set completed IDs based on today's results
      const today = new Date().toDateString();
      const todayCompleted = (todayResultsRes?.data?.results || [])
        .filter(r => r && r.createdAt && new Date(r.createdAt).toDateString() === today)
        .map(r => r.targetSentence)
        .filter(Boolean);
      
      setCompletedIds(todayCompleted);

      // Step 4: Build Mastery Tracker using ALL practice history
      const practiceHistory = progressRes?.data?.soundProgress || [];
      const allSoundsToTrack = Array.from(new Set([
        ...practiceHistory.map(p => p?.sound?.toUpperCase()),
        ...detectedWeakSounds.map(s => s?.toUpperCase())
      ])).filter(Boolean);

      const mergedProgress = allSoundsToTrack.map((sound, idx) => {
        const history = practiceHistory.find(p => {
          const pSound = (p?.sound || p?._id || "").toString().toUpperCase();
          return pSound === sound;
        });
        
        return {
          id: `mastery-${sound}-${idx}`,
          sound,
          averageScore: Math.max(0, Math.min(100, history?.averageScore || 0)),
          bestScore: history?.bestScore || 0,
          totalAttempts: history?.totalAttempts || 0,
          lastAttempt: history?.lastAttempt || null,
        };
      }).sort((a, b) => b.totalAttempts - a.totalAttempts);

      setSoundProgress(mergedProgress);

    } catch (err) {
      console.error("Critical Practice Data Load Error:", err);
      if (err.response?.status === 400) setNoWeakSounds(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPracticeData();
  }, [difficulty]);

  const getMasteryLevel = (score) => {
    if (score >= 90) return { label: 'Mastered', color: 'text-emerald-600', bg: 'bg-emerald-500', track: 'bg-emerald-100' };
    if (score >= 75) return { label: 'Proficient', color: 'text-teal-600', bg: 'bg-teal-500', track: 'bg-teal-100' };
    if (score >= 50) return { label: 'Improving', color: 'text-amber-600', bg: 'bg-amber-400', track: 'bg-amber-100' };
    return { label: 'Needs Practice', color: 'text-rose-600', bg: 'bg-rose-400', track: 'bg-rose-100' };
  };

  const completedCount = completedIds.length;
  const totalExercises = exercises.length || 5;
  const showVerification = completedCount >= totalExercises && totalExercises > 0 && !completedIds.includes('verification-done');
  
  const handleComplete = (id) => {
    if (!completedIds.includes(id)) {
      setUndoStack(prev => [...prev, id]); // HCI: push to undo stack
      setCompletedIds(prev => {
        const next = [...prev, id];
        // HCI: Show celebration when all exercises are done
        if (next.filter(x => x !== 'verification-done').length >= exercises.length && exercises.length > 0) {
          setTimeout(() => setShowCelebration(true), 600);
        }
        return next;
      });
      setTimeout(() => loadPracticeData(), 1500);
    }
  };

  // HCI: Undo last completed exercise
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setCompletedIds(prev => prev.filter(id => id !== last));
    setShowCelebration(false);
  };

  return (
    <div className="animate-fade-in-up min-h-screen relative pb-20">

      {/* ── HCI: Session Completion Celebration Overlay ── */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setShowCelebration(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
              className="bg-[var(--bg-surface)] rounded-[32px] p-10 text-center max-w-sm mx-4 shadow-2xl border border-[var(--border-subtle)]"
              onClick={e => e.stopPropagation()}
            >
              <motion.div
                animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                transition={{ delay: 0.3, duration: 0.6 }}
                className="text-5xl mb-4"
              >
                🎉
              </motion.div>
              <h2 className="text-2xl font-black text-[var(--text-primary)] font-syne tracking-tight mb-2">Session Complete!</h2>
              <p className="text-sm font-medium text-[var(--text-secondary)] mb-6">
                You've finished all <span className="font-black text-[var(--accent)]">{totalExercises}</span> exercises for today. Great work!
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => setShowCelebration(false)}
                  className="h-11 px-8 rounded-xl bg-[var(--accent)] text-white font-black text-sm uppercase tracking-widest hover:bg-teal-700 transition-all"
                  aria-label="Close celebration and return to practice"
                >
                  Continue Reviewing
                </button>
                <button
                  onClick={() => { setShowCelebration(false); handleUndo(); }}
                  className="h-9 px-8 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[var(--text-muted)] font-black text-xs uppercase tracking-widest hover:text-[var(--text-primary)] transition-all flex items-center justify-center gap-2"
                  aria-label="Undo last completed exercise"
                >
                  <Undo2 size={13} /> Undo Last
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {preselectedSound && (
        <motion.div 
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 p-4 bg-teal-500/10 border border-teal-500/20 rounded-2xl flex items-center justify-between gap-4 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">🎯</span>
            <div>
              <h4 className="text-[12px] font-black text-teal-700 uppercase tracking-wider">Sound Focus Mode Active</h4>
              <p className="text-xs text-[var(--text-secondary)] font-medium mt-0.5">
                We've customized your Practice Engine to target <strong>/{preselectedSound}/</strong> sounds, as recommended by your speech therapist.
              </p>
            </div>
          </div>
          <button 
            onClick={() => {
              navigate(location.pathname, { replace: true, state: {} });
              // Trigger reload
              setTimeout(() => window.location.reload(), 100);
            }}
            className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] hover:text-rose-500 border border-[var(--border-subtle)] hover:border-rose-400/30 px-3 py-1.5 rounded-xl bg-[var(--bg-surface)] transition-all shrink-0"
          >
            Clear Focus
          </button>
        </motion.div>
      )}

      <div className="relative mb-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <Breadcrumb />
            <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight font-syne">Practice Engine</h1>
            {userWeakSounds.length > 0 ? (
              <p className="text-[var(--text-secondary)] font-medium mt-1 text-sm">
                Targeting your weak sounds: {userWeakSounds.map(s => (
                  <span key={s} className="inline-block bg-[var(--accent-glow)] text-[var(--accent)] font-black text-[10px] px-2 py-0.5 rounded-md mr-1 uppercase">{s}</span>
                ))}
              </p>
            ) : (
              <p className="text-[var(--text-secondary)] font-medium mt-1 text-sm">Complete a recording session to unlock personalized exercises</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* HCI: Undo last exercise button */}
            {undoStack.length > 0 && (
              <button
                onClick={handleUndo}
                aria-label="Undo last completed exercise"
                title="Undo last exercise"
                className="flex items-center gap-2 h-10 px-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-amber-500 hover:border-amber-400/30 transition-all text-[10px] font-black uppercase tracking-widest"
              >
                <Undo2 size={14} /> Undo
              </button>
            )}
            <div className="flex items-center gap-5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-3 shadow-sm">
              <div className="text-center px-1">
                <p className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] mb-1">Daily Progress</p>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-black text-[var(--text-primary)] tracking-tighter">{completedCount}/{totalExercises}</span>
                </div>
              </div>
              <div className="w-10 h-10 bg-[var(--accent-glow)] rounded-xl flex items-center justify-center text-[var(--accent)]" aria-hidden="true"><Trophy size={20} /></div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mr-2">Difficulty:</span>
        {['easy', 'medium', 'hard'].map(d => (
          <button key={d} onClick={() => setDifficulty(d)} className={cn("px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all", difficulty === d ? "bg-[var(--accent)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)]")}>{d}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Exercises */}
        <div className="lg:col-span-2 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="animate-spin text-[var(--accent)]" size={32} />
              <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Loading personalized exercises...</p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {showVerification ? (
                <motion.div key="verification-mode" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
                  <ProgressCheckCard targetSound={topWeakSound} onComplete={() => setCompletedIds(prev => [...prev, 'verification-done'])} />
                </motion.div>
              ) : (
                exercises.map((ex, index) => (
                  <motion.div key={ex.id || `exercise-${index}`} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                    <ExerciseCard
                      exercise={ex}
                      onComplete={handleComplete}
                      isInitiallyCompleted={completedIds.includes(ex.id) || completedIds.includes(ex.text)}
                      isActive={activeCardId === ex.id}
                      onActivate={() => setActiveCardId(ex.id)}
                    />
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          )}
          {!showVerification && exercises.length === 0 && !loading && !noWeakSounds && (
            <div className="p-12 text-center bg-[var(--bg-surface)] rounded-3xl border border-dashed border-[var(--border-subtle)]">
              <Sparkles size={40} className="mx-auto text-[var(--text-muted)] mb-4 opacity-20" />
              <p className="text-[var(--text-muted)] font-bold uppercase tracking-widest text-xs">No exercises remaining for today</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="lg:sticky lg:top-24 self-start space-y-6">
          {/* Today's Focus */}
          <Card className="bg-[var(--accent-navy)] text-white border-none p-5">
            <h3 className="font-black text-base mb-3 flex items-center gap-2 font-syne uppercase tracking-tight"><Target size={18} /> Today's Focus</h3>
            <p className="text-white/80 text-sm leading-relaxed font-medium">
              {topWeakSound
                ? `The AI has identified "${topWeakSound}" as your primary challenge. These exercises are designed to build your confidence with this sound.`
                : "Practice daily to improve your fluency."}
            </p>
          </Card>

          {/* Sound Mastery Tracker */}
          <Card className="p-5">
            <h4 className="font-black text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)] mb-4 flex items-center gap-2">
              <TrendingUp size={13} /> Sound Mastery Tracker
            </h4>
            {soundProgress.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] font-medium text-center py-4 opacity-60">Complete exercises to start tracking your progress per sound.</p>
            ) : (
              <div className="space-y-4">
                {soundProgress.map((sp, idx) => {
                  const mastery = getMasteryLevel(sp.averageScore);
                  const uniqueKey = sp.id || `sp-${sp.sound}-${idx}`;
                  return (
                    <div key={uniqueKey} className="p-3 bg-[var(--bg-base)] rounded-2xl border border-[var(--border-subtle)]">
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center text-[10px] font-black text-[var(--text-primary)]">{sp.sound}</span>
                          <div>
                            <span className={`text-[9px] font-black uppercase tracking-wider ${mastery.color}`}>{mastery.label}</span>
                            <p className="text-[9px] text-[var(--text-muted)] font-bold">{sp.totalAttempts} attempt{sp.totalAttempts !== 1 ? 's' : ''}</p>
                          </div>
                        </div>
                        <span className="text-sm font-black text-[var(--text-primary)]">{sp.averageScore}<span className="text-[9px] text-[var(--text-muted)]">/100</span></span>
                      </div>
                      <div className={`h-1.5 ${mastery.track} rounded-full overflow-hidden`}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${sp.averageScore}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className={`h-full ${mastery.bg} rounded-full`}
                        />
                      </div>
                      {sp.bestScore > 0 && (
                        <p className="text-[8px] text-[var(--text-muted)] font-bold mt-1.5">Best: {sp.bestScore}/100</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Practice;
