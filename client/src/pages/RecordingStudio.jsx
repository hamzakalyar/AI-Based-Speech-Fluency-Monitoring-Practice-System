import React, { useState, useEffect, useRef } from 'react';
import {
   Mic, Square, Pause, Play, RotateCcw,
   Waves, Ruler, Sparkles, Trash2,
   ChevronRight, ChevronLeft, Share2, Save, MoreHorizontal,
   ArrowRight, CheckCircle2, Loader2, X,
   Volume2, ShieldCheck, Zap, FileText,
   Calendar, Target, Activity, Trophy,
   Star, MessageSquare, Headphones, Upload, CloudUpload,
   Clock, FileType, Check, VolumeX, Info, Quote,
   BookOpen, Search, Filter
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRecording } from '../hooks/useRecording';
import Breadcrumb from '../components/layout/Breadcrumb';
import WaveformCanvas from '../components/features/Recording/WaveformCanvas';
import { formatDuration } from '../utils/formatMetrics';
import { sessionsService } from '../services/sessionsService';
import { analyticsService } from '../services/analyticsService';
import passagesData from '../data/passages.json';

const RecordingStudio = () => {
   const navigate = useNavigate();
   const [showReRecordModal, setShowReRecordModal] = useState(false);
   const [showPassageModal, setShowPassageModal] = useState(false);
   const [passageFilter, setPassageFilter] = useState('all');
   const [passageSearch, setPassageSearch] = useState('');
   const [currentStep, setCurrentStep] = useState(0);
   const [passages, setPassages] = useState(passagesData.passages || []);
   const [activePassageIndex, setActivePassageIndex] = useState(0);
   const [isFreeRecord, setIsFreeRecord] = useState(false);
   const [weeklyStats, setWeeklyStats] = useState(null);
   const [lastSession, setLastSession] = useState(null);

   const audioRef = useRef(null);
   const fileInputRef = useRef(null);
   const [isPlaying, setIsPlaying] = useState(false);
   const [volume, setVolume] = useState(1);
   const [audioProgress, setAudioProgress] = useState(0);
   const [analysisStage, setAnalysisStage] = useState(0);

   const {
      status,
      duration,
      audioBlob,
      analyser,
      sessionId,
      analysisResults,
      analysisError,
      startRecording,
      stopRecording,
      pauseRecording,
      resumeRecording,
      startAnalysis,
      resetRecording,
      setExternalAudio
   } = useRecording();

   useEffect(() => {
      if (audioBlob && audioRef.current) {
         const url = URL.createObjectURL(audioBlob);
         audioRef.current.src = url;
         // CRITICAL: must call .load() after setting src dynamically —
         // browsers do NOT auto-load new blob URLs assigned via JavaScript
         audioRef.current.load();
         return () => URL.revokeObjectURL(url);
      }
   }, [audioBlob]);

    useEffect(() => {
       let interval;
       if (status === 'processing') {
          setAnalysisStage(0);
          interval = setInterval(() => {
             setAnalysisStage(prev => (prev < 4 ? prev + 1 : prev));
          }, 2500);
       } else {
          setAnalysisStage(0);
       }
       return () => clearInterval(interval);
    }, [status]);

   const togglePlayback = () => {
      if (!audioRef.current) return;
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
      setIsPlaying(!isPlaying);
   };

   const handleTimeUpdate = () => {
      if (audioRef.current) {
         const progress = (audioRef.current.currentTime / audioRef.current.duration) * 100;
         setAudioProgress(progress);
      }
   };

   const handleFileUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const blob = new Blob([file], { type: file.type });
      const tempAudio = new Audio();
      tempAudio.src = URL.createObjectURL(blob);
      
      tempAudio.onloadedmetadata = () => {
         setExternalAudio(blob, Math.round(tempAudio.duration));
         URL.revokeObjectURL(tempAudio.src);
      };
   };

   const steps = [
      { label: 'READY', status: 'idle' },
      { label: 'RECORDING', status: ['recording', 'paused'] },
      { label: 'REVIEW', status: 'reviewing' },
      { label: 'ANALYSIS', status: 'processing' }
   ];

   const getActiveStep = () => {
      if (status === 'idle' || status === 'permissions') return 0;
      if (status === 'recording' || status === 'paused') return 1;
      if (status === 'reviewing') return 2;
      if (status === 'processing') return 3;
      return 0;
   };

   const activeStep = getActiveStep();

   const MOCK_DEMO_PASSAGES = [
      {
         id: 'passage-1',
         title: 'Rainbow Passage (Plosives Focus)',
         text: 'When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. The rainbow is a division of white light into many beautiful colors.',
         targetSounds: ['/p/', '/b/', '/t/', '/d/']
      },
      {
         id: 'passage-2',
         title: 'Consonant Cluster Drills',
         text: 'Clean clams cram in clean canned chalets. The struggle to speak clearly brings strength to the vocal cords and builds massive confidence.',
         targetSounds: ['/cl/', '/cr/', '/str/']
      },
      {
         id: 'passage-3',
         title: 'Vowel Prolongation Exercise',
         text: 'Always hold your breath softly before initiating a long vowel. Easy onset helps smooth out repetitions and allows a fluent stream of sound.',
         targetSounds: ['/e/', '/o/', '/a/']
      }
   ];
   
   const MOCK_DEMO_WEEKLY_STATS = {
      totalSessions: 3,
      avgSpeechRate: 135,
      latestFluencyScore: 84
   };

   const MOCK_DEMO_LAST_SESSION = {
      id: 'mock-session-2',
      type: 'Practice',
      name: 'Plosives Reading Drill',
      fluencyScore: 78
   };

   useEffect(() => {
      const loadSidebarData = async () => {
         const isDemo = localStorage.getItem('is_demo_mode') === 'true';
         if (isDemo) {
            setPassages(passagesData.passages || MOCK_DEMO_PASSAGES);
            setWeeklyStats(MOCK_DEMO_WEEKLY_STATS);
            setLastSession(MOCK_DEMO_LAST_SESSION);
            return;
         }

         try {
            const [passagesResult, statsResult, lastSessionResult] = await Promise.allSettled([
               sessionsService.getPassages(),
               analyticsService.getSummary(),
               sessionsService.getSessions({ limit: 1 })
            ]);

            if (passagesResult.status === 'fulfilled' && passagesResult.value?.data) {
               const rawPassages =
                  passagesResult.value.data?.passages ||
                  (Array.isArray(passagesResult.value.data) ? passagesResult.value.data : null);

               if (rawPassages && rawPassages.length > 0) {
                  const normalised = rawPassages.map(p => ({
                     ...p,
                     id: p.id || p._id || '',
                     title: p.title || p.name || p.id || 'Passage',
                     text: p.text || '',
                     targetSounds: p.targetSounds || [],
                  }));
                  setPassages(normalised);
               } else if (passagesData.passages?.length > 0) {
                  setPassages(passagesData.passages);
               }
            } else if (passagesData.passages?.length > 0) {
               // Resilient fallback to built-in clinical passages
               setPassages(passagesData.passages);
            }

            if (statsResult.status === 'fulfilled') {
               setWeeklyStats(statsResult.value?.data);
            }

            if (lastSessionResult.status === 'fulfilled' && lastSessionResult.value?.data?.sessions?.length > 0) {
               setLastSession(lastSessionResult.value.data.sessions[0]);
            }
         } catch (e) {
            console.error("Failed to fetch sidebar data", e);
            if (passagesData.passages?.length > 0) {
               setPassages(passagesData.passages);
            }
         }
      };
      loadSidebarData();
   }, []);

   const activePassage = passages[activePassageIndex] || passagesData.passages?.[0] || null;
   const currentPassageText = activePassage ? activePassage.text : "Select a passage to begin your practice.";

   return (
      <div className="animate-fade-in pb-12 relative min-h-screen">
         <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} className="hidden" />
         <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[var(--accent)]/5 rounded-full blur-[140px] -z-10 pointer-events-none opacity-60 dark:opacity-20" />
         
         <div className="mb-10">
            <Breadcrumb />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-2">
               <div>
                  <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight font-syne">Recording Studio</h1>
                  <p className="text-[var(--text-secondary)] font-medium text-sm mt-2">Practice your fluency with guided passages and free recording</p>
               </div>
            </div>
         </div>

         <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            <div className="flex flex-col gap-6 min-h-0">

               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-8 sm:gap-4 mb-2">
                  <div className="flex items-center gap-3 p-1 bg-[var(--bg-elevated)] rounded-xl w-fit border border-[var(--border-subtle)] shadow-sm shrink-0">
                     <button onClick={() => setIsFreeRecord(false)} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${!isFreeRecord ? 'bg-[var(--bg-surface)] text-teal-600 shadow-sm ring-1 ring-[var(--border-subtle)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>Daily Routine</button>
                     <button onClick={() => setIsFreeRecord(true)} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${isFreeRecord ? 'bg-[var(--bg-surface)] text-teal-600 shadow-sm ring-1 ring-[var(--border-subtle)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>Free Record</button>
                  </div>

                  <div className="flex w-full sm:max-w-sm items-center justify-between px-2 relative">
                     <div className="absolute top-[7px] left-[10%] right-[10%] h-[2px] bg-[var(--border-subtle)] -z-10" />
                     {steps.map((step, idx) => (
                        <div key={idx} className="flex flex-col items-center justify-center gap-2 z-10 w-16">
                           <div className={`w-4 h-4 rounded-full border-[3px] transition-all duration-500 ${
                              activeStep === idx ? 'bg-teal-500 border-teal-500 ring-4 ring-teal-500/20' :
                              activeStep > idx ? 'bg-teal-500 border-teal-500' : 'bg-[var(--bg-base)] border-[var(--border-subtle)]'
                           }`} />
                           <span className={`text-[9px] font-black tracking-widest transition-all uppercase whitespace-nowrap ${
                              activeStep === idx ? 'text-teal-600' : 'text-[var(--text-muted)]'
                           }`}>
                              {step.label}
                           </span>
                        </div>
                     ))}
                  </div>
               </div>

               {isFreeRecord ? (
                  /* FREE RECORD MODE — no script, no passage, just record freely */
                  <div className="bg-[var(--bg-surface)] rounded-2xl p-6 shadow-sm border border-[var(--border-subtle)] relative flex flex-col gap-4 flex-1 min-h-[400px] sm:min-h-[450px]">
                     <div className="flex flex-col items-center justify-center gap-3 text-center px-8 h-full">
                        <div className="w-14 h-14 rounded-full bg-teal-500/10 flex items-center justify-center text-teal-500 mb-2">
                           <Mic size={26} />
                        </div>
                         <p className="text-[16px] font-semibold text-[var(--text-primary)] leading-relaxed">
                            Speak freely — talk about anything you like.
                         </p>
                         <p className="text-[12px] text-[var(--text-muted)] font-medium max-w-sm">
                            Your fluency, speech rate, and stutters will be analyzed without comparing to any script.
                         </p>
                      </div>
                   </div>
                ) : (
                   /* DAILY ROUTINE MODE — passage reading with script */
                   <div className="bg-[var(--bg-surface)] rounded-3xl p-6 pb-8 shadow-sm border border-[var(--border-subtle)] relative flex flex-col gap-4 flex-1 min-h-[420px]">
                      {/* Passage Controls Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
                         <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-600 dark:text-teal-400 shrink-0">
                               <Target size={14} />
                            </div>
                            <div className="min-w-0">
                               <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[11px] font-black uppercase tracking-widest text-[var(--text-primary)] truncate">
                                     {activePassage?.title || 'Active Passage'}
                                  </span>
                                  {activePassage?.difficulty && (
                                     <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0 ${
                                        activePassage.difficulty === 'easy'
                                           ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-200/50'
                                           : activePassage.difficulty === 'medium'
                                           ? 'bg-amber-500/10 text-amber-600 border border-amber-200/50'
                                           : 'bg-purple-500/10 text-purple-600 border border-purple-200/50'
                                     }`}>
                                        {activePassage.difficulty}
                                     </span>
                                  )}
                               </div>
                               {activePassage?.description && (
                                  <p className="text-[11px] text-[var(--text-muted)] font-medium line-clamp-1 mt-0.5">
                                     {activePassage.description}
                                  </p>
                               )}
                            </div>
                         </div>

                         {/* Quick Switcher & Browse Button */}
                         <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                            {/* Prev / Next Arrows */}
                            <div className="flex items-center bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] p-0.5">
                               <button
                                  onClick={() => setActivePassageIndex(prev => (prev > 0 ? prev - 1 : passages.length - 1))}
                                  disabled={activeStep !== 0}
                                  title="Previous passage"
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-teal-600 hover:bg-[var(--bg-surface)] disabled:opacity-40 transition-all"
                               >
                                  <ChevronLeft size={14} />
                               </button>
                               <span className="text-[10px] font-mono font-bold px-2 text-[var(--text-muted)]">
                                  {activePassageIndex + 1}/{passages.length}
                               </span>
                               <button
                                  onClick={() => setActivePassageIndex(prev => (prev < passages.length - 1 ? prev + 1 : 0))}
                                  disabled={activeStep !== 0}
                                  title="Next passage"
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-teal-600 hover:bg-[var(--bg-surface)] disabled:opacity-40 transition-all"
                               >
                                  <ChevronRight size={14} />
                               </button>
                            </div>

                            {/* Dropdown Select with explicitly styled options */}
                            <select 
                               value={activePassageIndex} 
                               onChange={(e) => setActivePassageIndex(Number(e.target.value))}
                               disabled={activeStep !== 0}
                               className="bg-[var(--bg-elevated)] text-[10px] sm:text-[11px] font-bold text-[var(--text-primary)] px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] outline-none cursor-pointer max-w-[160px] truncate"
                            >
                               {passages.map((p, idx) => (
                                  <option key={p.id} value={idx} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 py-1">
                                     {p.title || `Passage ${idx + 1}`}
                                  </option>
                               ))}
                            </select>

                            {/* Browse All Passages Button */}
                            <button
                               onClick={() => setShowPassageModal(true)}
                               disabled={activeStep !== 0}
                               className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-500/10 hover:bg-teal-500/20 text-teal-600 dark:text-teal-400 font-black text-[10px] uppercase tracking-wider transition-all disabled:opacity-40 border border-teal-500/20"
                            >
                               <BookOpen size={13} />
                               <span className="hidden sm:inline">Browse</span> ({passages.length})
                            </button>
                         </div>
                      </div>

                      {/* Passage Script Content */}
                      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar py-6 px-6 sm:px-10 flex flex-col items-center justify-center text-center">
                         <div className="w-8 h-8 rounded-full bg-teal-500/10 flex items-center justify-center text-teal-500 mb-3 opacity-60">
                            <Quote size={16} />
                         </div>
                         <p className="text-[17px] sm:text-[21px] font-medium text-[var(--text-secondary)] leading-[1.8] font-serif italic max-w-2xl">
                            "{currentPassageText}"
                         </p>
                         <div className="flex items-center gap-4 mt-4 text-[10px] font-mono text-[var(--text-muted)]">
                            {activePassage?.wordCount && <span>{activePassage.wordCount} words</span>}
                            {activePassage?.estimatedDuration && <span>Est. ~{activePassage.estimatedDuration}s reading</span>}
                         </div>
                      </div>

                      {/* Target Sounds Footer */}
                      {activePassage && activePassage.targetSounds && activePassage.targetSounds.length > 0 && (
                         <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 rounded-2xl">
                            <div className="flex flex-wrap items-center gap-1.5">
                               <span className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest mr-1">Phonetic Targets:</span>
                               {activePassage.targetSounds.map(sound => (
                                  <span key={sound} className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-200/40">
                                     {sound}
                                  </span>
                               ))}
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)] italic">
                               Read at your natural speaking pace
                            </span>
                         </div>
                      )}
                   </div>
                )}

               <div className="bg-[#0F172A] rounded-3xl shadow-lg p-6 flex flex-col gap-4 relative overflow-hidden text-white min-h-[400px] sm:min-h-[450px]">
                  <div className="flex justify-between items-center px-1 mb-0.5 shrink-0">
                     <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">STUDIO CONSOLE</span>
                     </div>
                     <span className="text-[10px] font-mono bg-white/10 px-2 py-0.5 rounded-full text-slate-300 font-bold">{status === 'recording' ? formatDuration(duration) : '0:00'}</span>
                  </div>

                  {status === 'idle' && (
                     <div className="flex flex-col items-center justify-center animate-fade-in relative gap-8 flex-1">
                        <div className="relative z-10 flex items-center justify-center gap-16 w-full">
                           <div className="flex flex-col items-center gap-4">
                              <button onClick={startRecording} className="group relative w-20 h-20 rounded-full bg-[#0D9488] shadow-[0_0_30px_rgba(13,148,136,0.3)] flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-300">
                                 <Mic size={28} className="text-white" />
                              </button>
                              <span className="text-[11px] font-black text-white uppercase tracking-widest">START LIVE</span>
                           </div>
                           <div className="flex flex-col items-center gap-4">
                               <input 
                                 type="file" 
                                 ref={fileInputRef} 
                                 onChange={handleFileUpload} 
                                 accept="audio/*" 
                                 className="hidden" 
                               />
                               <button 
                                 onClick={() => fileInputRef.current?.click()}
                                className="group relative w-20 h-20 rounded-full bg-white/10 border border-white/20 flex items-center justify-center hover:bg-white/20 hover:border-teal-500/50 transition-all active:scale-95"
                               >
                                  <CloudUpload size={26} className="text-white/70 group-hover:text-teal-300" />
                               </button>
                               <span className="text-[11px] font-black text-slate-300 uppercase tracking-widest">UPLOAD DEVICE</span>
                            </div>
                        </div>
                     </div>
                  )}

                  {(status === 'recording' || status === 'paused') && (
                     <div className="flex flex-col items-center justify-center animate-fade-in py-8 gap-4">
                        <div className="text-center mb-2 shrink-0">
                           <h2 className="font-mono text-[36px] font-bold text-red-400 tracking-wider leading-none">{formatDuration(duration)}</h2>
                        </div>
                        <div className="w-full h-10 mb-3 bg-white/10 rounded-xl flex items-center justify-center border border-white/20 px-6 shrink-0">
                           <WaveformCanvas analyser={analyser} isRecording={status === 'recording'} color="#2DD4BF" bars={36} />
                        </div>
                        <div className="flex justify-center gap-3 w-full px-6 shrink-0">
                           <button onClick={status === 'recording' ? pauseRecording : resumeRecording} className="flex-1 max-w-[120px] h-10 rounded-xl border-2 border-amber-500 text-amber-500 flex items-center justify-center gap-2 font-bold text-[12px]">
                              {status === 'recording' ? <><Pause size={16} /> PAUSE</> : <><Play size={16} fill="currentColor" /> RESUME</>}
                           </button>
                           <button onClick={stopRecording} className="flex-1 max-w-[120px] h-10 rounded-xl bg-red-500 text-white flex items-center justify-center gap-2 font-bold text-[12px]">
                              <Square size={14} fill="currentColor" /> FINISH
                           </button>
                        </div>
                     </div>
                  )}

                  {status === 'reviewing' && (
                     <div className="flex flex-col items-center justify-center animate-fade-in py-8 gap-4">
                        <div className="w-full max-w-sm bg-white/10 rounded-xl p-4 border border-white/20 flex flex-col gap-2 shrink-0">
                           <div className="flex items-center gap-2">
                              <button onClick={togglePlayback} className="w-8 h-8 rounded-full bg-teal-500 text-white flex items-center justify-center shrink-0">
                                 {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                              </button>
                              <div className="h-1 flex-1 bg-white/20 rounded-full relative overflow-hidden">
                                 <div className="absolute left-0 top-0 h-full bg-teal-500" style={{ width: `${audioProgress}%` }} />
                              </div>
                              <span className="text-[10px] font-mono text-white/60">{formatDuration(duration)}</span>
                           </div>
                        </div>
                        <div className="flex flex-col gap-2 w-full max-w-[240px] shrink-0">
                           {/* Free Record: no passageId, no expectedText → pure fluency analysis, no script comparison */}
                           <button onClick={() => startAnalysis(isFreeRecord ? null : activePassage?.id, isFreeRecord ? null : activePassage?.text)} className="h-10 bg-teal-500 text-white rounded-xl font-bold text-[12px] flex items-center gap-2 justify-center shadow-lg">START ANALYSIS <ArrowRight size={16} /></button>
                           <button onClick={() => setShowReRecordModal(true)} className="h-8 border border-red-500/20 text-red-400 rounded-xl font-bold text-[9px] uppercase tracking-widest flex items-center justify-center gap-2">
                              <RotateCcw size={12} /> RE-RECORD
                           </button>
                        </div>
                     </div>
                  )}

                  {status === 'processing' && (
                     <div className="flex flex-col items-center justify-center animate-fade-in py-8 px-6 gap-5 flex-1 w-full max-w-sm mx-auto">
                        <div className="relative w-14 h-14 flex items-center justify-center mb-1 shrink-0">
                           <div className="absolute inset-0 rounded-full border-4 border-teal-500/10 border-t-teal-500 animate-spin" />
                           <Zap size={20} className="text-teal-400 animate-pulse" />
                        </div>
                        
                        <div className="text-center shrink-0">
                           <h3 className="text-[11px] font-black text-white/90 mb-1 uppercase tracking-[0.2em] font-syne">AI Evaluation In Progress</h3>
                           <p className="text-[10px] text-slate-400 font-medium">Running advanced phonetic classification</p>
                        </div>

                        {/* Pipeline stages steps */}
                        <div className="w-full space-y-3 bg-white/[0.03] border border-white/5 rounded-2xl p-4 text-left shrink-0">
                           {[
                              "Normalising secure WAV audio envelopes",
                              "Extracting Whisper time-aligned phonemes",
                              "Analyzing pitch contour & silence gaps",
                              "Classifying neural stutter disfluencies",
                              "Compiling interactive clinical details"
                           ].map((stageLabel, idx) => {
                              const isCompleted = analysisStage > idx;
                              const isActive = analysisStage === idx;
                              return (
                                 <div key={idx} className="flex items-center gap-3 transition-all duration-300">
                                    <div className={`w-4 h-4 rounded-full flex items-center justify-center border transition-all shrink-0 ${
                                       isCompleted 
                                          ? 'bg-teal-500/20 border-teal-400 text-teal-400' 
                                          : isActive 
                                             ? 'border-cyan-400 text-cyan-400 animate-pulse' 
                                             : 'border-slate-800 text-slate-600'
                                    }`}>
                                       {isCompleted ? (
                                          <Check size={10} strokeWidth={3} className="shrink-0" />
                                       ) : isActive ? (
                                          <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping shrink-0" />
                                       ) : (
                                          <span className="text-[8px] font-mono font-bold shrink-0">{idx + 1}</span>
                                       )}
                                    </div>
                                    <span className={`text-[10px] font-bold ${
                                       isCompleted 
                                          ? 'text-teal-400/80 line-through' 
                                          : isActive 
                                             ? 'text-cyan-300 font-black' 
                                             : 'text-slate-500'
                                    }`}>
                                       {stageLabel}
                                    </span>
                                 </div>
                              );
                           })}
                        </div>
                     </div>
                  )}

                  {status === 'success' && (
                     <div className="flex flex-col items-center justify-center animate-fade-in relative z-10 py-12 gap-4">
                        <div className="w-12 h-12 bg-teal-500/20 text-teal-500 rounded-full flex items-center justify-center mb-3 shrink-0">
                           <CheckCircle2 size={24} />
                        </div>
                        <h3 className="text-[12px] font-black text-white/90 mb-1 uppercase tracking-[0.2em]">Analysis Complete</h3>
                        <button onClick={() => navigate(`/sessions/${sessionId}`)} className="h-10 px-8 bg-teal-500 text-[var(--accent-navy)] rounded-xl font-black text-[12px] tracking-widest hover:scale-[1.05] active:scale-[0.95] transition-all flex items-center gap-2 justify-center shadow-[0_0_40px_rgba(20,184,166,0.3)]">
                           VIEW FULL REPORT <ChevronRight size={18} />
                        </button>
                     </div>
                  )}

                  {status === 'error' && (
                     <div className="flex-1 flex flex-col items-center justify-center animate-fade-in relative z-10 overflow-y-auto custom-scrollbar p-2 text-center">
                        <div className="w-12 h-12 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mb-3 shrink-0">
                           <X size={24} />
                        </div>
                        <h3 className="text-[12px] font-black text-red-400 mb-1 uppercase tracking-[0.2em]">Analysis Failed</h3>
                        <p className="text-[10px] text-slate-400 mb-4 max-w-[220px] mx-auto leading-normal">
                           {analysisError || "A server error occurred. Please try again later."}
                        </p>
                        <div className="flex flex-col gap-2 w-full max-w-[180px] mx-auto">
                           <button 
                              onClick={() => startAnalysis(isFreeRecord ? null : activePassage?.id, isFreeRecord ? null : activePassage?.text)} 
                              className="h-10 bg-teal-500 text-slate-900 rounded-xl font-black text-[11px] tracking-wider uppercase hover:scale-[1.03] active:scale-[0.97] transition-all flex items-center gap-2 justify-center shadow-lg"
                           >
                              Try Again <RotateCcw size={14} />
                           </button>
                           <button 
                              onClick={resetRecording} 
                              className="h-8 border border-slate-700 text-slate-300 rounded-xl font-black text-[9px] tracking-widest uppercase hover:bg-slate-800 transition-all"
                           >
                              Re-Record
                           </button>
                        </div>
                     </div>
                  )}
               </div>
            </div>

            <div className="flex flex-col gap-6">
               <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-subtle)] p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                     <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">WEEKLY GOAL</span>
                     <span className="text-[11px] font-black text-[var(--accent)]">{weeklyStats?.totalSessions > 0 ? Math.round(Math.min(((weeklyStats?.totalSessions || 0) / 7) * 100, 100)) : 0}%</span>
                  </div>
                  <div className="flex items-center gap-4">
                     <div className="relative w-12 h-12 shrink-0">
                        <svg className="w-12 h-12 -rotate-90">
                           <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-[var(--border-subtle)]" />
                           <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={125.6} strokeDashoffset={125.6 * (1 - Math.min((weeklyStats?.totalSessions || 0) / 7, 1))} className="text-[var(--accent)]" strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                           <span className="text-[10px] font-black text-[var(--text-primary)]">{(weeklyStats?.totalSessions || 0)}/7</span>
                        </div>
                     </div>
                     <p className="text-[11px] text-[var(--text-secondary)] font-medium">Progress towards your goal.</p>
                  </div>
               </div>

               <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-subtle)] p-6 shadow-sm">
                  <h3 className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-3">THIS WEEK</h3>
                  <div className="space-y-2">
                     {[
                        { icon: Activity, label: 'Sessions', val: weeklyStats?.totalSessions || '0', color: 'text-[var(--accent)]' },
                        { icon: Zap, label: 'Avg WPM', val: weeklyStats?.avgSpeechRate || '0', color: 'text-amber-500' },
                        { icon: Trophy, label: 'Best Score', val: `${weeklyStats?.latestFluencyScore || 0}%`, color: 'text-purple-500', valColor: 'text-[var(--accent)]' }
                     ].map((s, i) => (
                        <div key={i} className="flex items-center justify-between border-b border-[var(--border-subtle)] last:border-0 pb-2 last:pb-0">
                           <div className="flex items-center gap-3">
                              <s.icon size={14} className={s.color} />
                              <span className="text-[12px] font-bold text-[var(--text-primary)]">{s.label}</span>
                           </div>
                           <span className={`text-[12px] font-black ${s.valColor || 'text-[var(--text-primary)]'}`}>{s.val}</span>
                        </div>
                     ))}
                  </div>
               </div>

               <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-subtle)] p-6 shadow-sm">
                  <h3 className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-3">PREPARATION</h3>
                  <div className="space-y-2">
                     {[{ icon: Volume2, title: 'Natural Pace' }, { icon: ShieldCheck, title: 'No Noise' }].map((tip, idx) => (
                        <div key={idx} className="flex gap-3 items-center">
                           <div className="w-7 h-7 rounded-full bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)] shrink-0 border border-[var(--border-subtle)]"><tip.icon size={12} /></div>
                           <p className="text-[12px] font-bold text-[var(--text-primary)]">{tip.title}</p>
                        </div>
                     ))}
                  </div>
               </div>
            </div>
         </div>

         {showReRecordModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
               <div className="bg-[var(--bg-surface)] rounded-3xl p-5 max-w-xs w-full text-center shadow-2xl">
                  <div className="w-10 h-10 bg-red-50 text-red-500 rounded-xl flex items-center justify-center mx-auto mb-3"><Trash2 size={20} /></div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">Delete Recording?</h3>
                  <div className="flex flex-col gap-2 mt-4">
                     <button onClick={() => { resetRecording(); setShowReRecordModal(false); }} className="w-full py-2.5 rounded-xl bg-red-500 text-white font-bold text-[11px]">Delete & Redo</button>
                     <button onClick={() => setShowReRecordModal(false)} className="w-full py-2.5 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-muted)] font-bold text-[11px]">Cancel</button>
                  </div>
               </div>
            </div>
         )}

         {/* BROWSE ALL PASSAGES MODAL */}
         {showPassageModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
               <div className="bg-[var(--bg-surface)] rounded-3xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-[var(--border-subtle)] overflow-hidden">
                  {/* Modal Header */}
                  <div className="p-6 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0 bg-[var(--bg-elevated)]/40">
                     <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-teal-500/10 flex items-center justify-center text-teal-600 dark:text-teal-400">
                           <BookOpen size={20} />
                        </div>
                        <div>
                           <h2 className="text-lg font-black text-[var(--text-primary)] font-syne">Clinical Assessment Passages</h2>
                           <p className="text-xs text-[var(--text-muted)] font-medium">Select a research-backed passage to target specific speech disfluencies</p>
                        </div>
                     </div>
                     <button
                        onClick={() => setShowPassageModal(false)}
                        className="w-8 h-8 rounded-full bg-[var(--bg-elevated)] hover:bg-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                     >
                        <X size={16} />
                     </button>
                  </div>

                  {/* Search and Difficulty Filter Controls */}
                  <div className="p-4 border-b border-[var(--border-subtle)] flex flex-col sm:flex-row gap-3 items-center justify-between bg-[var(--bg-surface)] shrink-0">
                     <div className="relative w-full sm:w-72">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                           type="text"
                           placeholder="Search by title, sound, or word..."
                           value={passageSearch}
                           onChange={(e) => setPassageSearch(e.target.value)}
                           className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-teal-500 transition-all"
                        />
                     </div>

                     <div className="flex items-center gap-1.5 self-start sm:self-auto overflow-x-auto w-full sm:w-auto">
                        {['all', 'easy', 'medium', 'hard'].map(diff => (
                           <button
                              key={diff}
                              onClick={() => setPassageFilter(diff)}
                              className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                                 passageFilter === diff
                                    ? 'bg-teal-500 text-white shadow-sm'
                                    : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                              }`}
                           >
                              {diff}
                           </button>
                        ))}
                     </div>
                  </div>

                  {/* Passages Grid */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
                     {passages
                        .filter(p => {
                           const matchesDiff = passageFilter === 'all' || p.difficulty === passageFilter;
                           const searchLower = passageSearch.toLowerCase();
                           const matchesSearch = !passageSearch || 
                              p.title?.toLowerCase().includes(searchLower) ||
                              p.description?.toLowerCase().includes(searchLower) ||
                              p.targetSounds?.some(s => s.toLowerCase().includes(searchLower)) ||
                              p.text?.toLowerCase().includes(searchLower);
                           return matchesDiff && matchesSearch;
                        })
                        .map(p => {
                           const idx = passages.findIndex(item => item.id === p.id);
                           const isSelected = activePassageIndex === idx;
                           return (
                              <div
                                 key={p.id}
                                 onClick={() => {
                                    setActivePassageIndex(idx);
                                    setShowPassageModal(false);
                                 }}
                                 className={`p-4 rounded-2xl border transition-all cursor-pointer text-left flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                                    isSelected 
                                       ? 'bg-teal-500/5 border-teal-500 ring-2 ring-teal-500/20 shadow-md'
                                       : 'bg-[var(--bg-elevated)]/60 hover:bg-[var(--bg-elevated)] border-[var(--border-subtle)] hover:border-teal-500/30'
                                 }`}
                              >
                                 <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                       <h3 className="font-bold text-sm text-[var(--text-primary)]">{p.title}</h3>
                                       {p.difficulty && (
                                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                             p.difficulty === 'easy' ? 'bg-emerald-500/10 text-emerald-600' :
                                             p.difficulty === 'medium' ? 'bg-amber-500/10 text-amber-600' :
                                             'bg-purple-500/10 text-purple-600'
                                          }`}>
                                             {p.difficulty}
                                          </span>
                                       )}
                                       {p.wordCount && (
                                          <span className="text-[10px] font-mono text-[var(--text-muted)]">
                                             {p.wordCount} words
                                          </span>
                                       )}
                                       {p.estimatedDuration && (
                                          <span className="text-[10px] font-mono text-[var(--text-muted)]">
                                             ~{p.estimatedDuration}s
                                          </span>
                                       )}
                                    </div>
                                    <p className="text-xs text-[var(--text-muted)] line-clamp-1 mb-2">
                                       {p.description || p.text}
                                    </p>
                                    <div className="flex flex-wrap gap-1">
                                       {p.targetSounds?.map(s => (
                                          <span key={s} className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-teal-500/10 text-teal-600">
                                             {s}
                                          </span>
                                       ))}
                                    </div>
                                 </div>

                                 <button
                                    className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider shrink-0 transition-all ${
                                       isSelected
                                          ? 'bg-teal-500 text-white shadow-sm'
                                          : 'border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-teal-500/10 hover:text-teal-600'
                                    }`}
                                 >
                                    {isSelected ? 'Active' : 'Select'}
                                 </button>
                              </div>
                           );
                        })}
                  </div>
               </div>
            </div>
         )}
      </div>
   );
};

export default RecordingStudio;
