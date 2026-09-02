import { useState, useRef, useCallback, useEffect } from 'react';
import { sessionsService } from '../services/sessionsService';

/**
 * Custom hook to manage the recording state machine.
 * States: idle | permissions | recording | paused | reviewing | processing | success | error
 */
export const useRecording = () => {
  const [status, setStatus] = useState('idle');
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [analyser, setAnalyser] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const chunksRef = useRef([]);
  const audioBlobRef = useRef(null);
  // Voice-activity detection: tracks whether any non-silent audio was captured
  const hasVoiceRef = useRef(false);
  const vadIntervalRef = useRef(null);

  const startRecording = useCallback(async () => {
    try {
      setStatus('permissions');
      setAnalysisError(null);
      setSessionId(null);
      setAnalysisResults(null);
      chunksRef.current = [];
      hasVoiceRef.current = false;  // Reset VAD flag for this new recording

      let stream;
      try {
        // Request high-quality audio for speech analysis:
        // - 48kHz sample rate (Whisper processes at 16kHz; browser downsamples cleanly)
        // - Mono channel (speech analysis does not benefit from stereo)
        // - Echo cancellation + noise suppression + auto gain for clean input
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: { ideal: 48000, min: 16000 },
            sampleSize: 16,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        });
      } catch (micError) {
        console.error('Microphone access denied or unavailable:', micError);
        setAnalysisError(
          micError.name === 'NotAllowedError'
            ? 'Microphone access was denied. Please allow microphone access in your browser settings and try again.'
            : 'Could not access your microphone. Please check it is connected and not in use by another app.'
        );
        setStatus('error');
        return; // stop here — do NOT fake a recording
      }

      streamRef.current = stream;

      // Set up AudioContext for waveform visualisation
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 1024;   // Higher resolution waveform
        analyserNode.smoothingTimeConstant = 0.8;

        // DynamicsCompressor normalises volume so quiet speakers still register
        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
        compressor.knee.setValueAtTime(30, audioCtx.currentTime);
        compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
        compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
        compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

        source.connect(compressor);
        compressor.connect(analyserNode);
        setAnalyser(analyserNode);

        // ─── Real-time Voice Activity Detection ───────────────────────────
        // Poll the analyser every 100ms; compute RMS amplitude.
        // -50 dBFS ≈ typical background noise floor — any voice exceeds this.
        const vadBuffer = new Uint8Array(analyserNode.fftSize);
        vadIntervalRef.current = setInterval(() => {
          analyserNode.getByteTimeDomainData(vadBuffer);
          let sumSq = 0;
          for (let i = 0; i < vadBuffer.length; i++) {
            const normalized = (vadBuffer[i] - 128) / 128; // range [-1, 1]
            sumSq += normalized * normalized;
          }
          const rms = Math.sqrt(sumSq / vadBuffer.length);
          // rms > 0.01 ≈ -40 dBFS — clearly above silence
          if (rms > 0.01) hasVoiceRef.current = true;
        }, 100);
        // ─────────────────────────────────────────────────────────────────
      } catch (ctxError) {
        // Waveform visualisation won't work but recording can still proceed
        console.warn('AudioContext failed — waveform disabled:', ctxError);
      }

      // Detect best supported MIME type at runtime, prefer Opus for high-quality speech
      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm',
        'audio/mp4',
        '',
      ];
      const mimeType = preferredTypes.find(t => t === '' || MediaRecorder.isTypeSupported(t));
      const recorderOptions = mimeType
        ? { mimeType, audioBitsPerSecond: 128000 }
        : { audioBitsPerSecond: 128000 };
      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Stop VAD polling first
        if (vadIntervalRef.current) {
          clearInterval(vadIntervalRef.current);
          vadIntervalRef.current = null;
        }

        // Immediate rejection if no voice was detected during the entire recording
        if (!hasVoiceRef.current) {
          console.warn('No voice detected during recording — rejecting.');
          setAnalysisError('No voice detected. Make sure your microphone is working and you spoke during the recording.');
          setStatus('error');
          chunksRef.current = [];
          return;
        }

        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        if (blob.size < 4000) {
          // Blob is suspiciously small — likely empty/corrupt recording (< ~0.5s of opus audio)
          console.warn('Recorded blob is too small:', blob.size, 'bytes');
          setAnalysisError('Recording was too short or captured no audio. Please try again — speak clearly for at least 3 seconds.');
          setStatus('error');
          return;
        }
        setAudioBlob(blob);
        audioBlobRef.current = blob;
        setStatus('reviewing');
      };

      // 1-second timeslice: fires ondataavailable every 1s
      recorder.start(1000);
      setStatus('recording');

      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Recording initialization error:', err);
      setAnalysisError('Failed to start recording: ' + err.message);
      setStatus('error');
    }
  }, []);

  // Cleanup on unmount: close AudioContext and stop mic tracks to prevent resource leaks
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
    };
  }, []);

  const stopRecording = useCallback(() => {
    if (status === 'recording' || status === 'paused') {
      // Stop VAD polling immediately when user presses stop
      if (vadIntervalRef.current) {
        clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      } else {
        // No recorder — nothing was actually captured
        setAnalysisError('No audio was captured. Please ensure your microphone is working and try again.');
        setStatus('error');
        return;
      }
      streamRef.current?.getTracks().forEach(track => track.stop());
      // Close the AudioContext to free browser resources (browsers cap at ~6 concurrent)
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      setAnalyser(null);
      clearInterval(timerRef.current);
    }
  }, [status]);

  const pauseRecording = useCallback(() => {
    if (status === 'recording') {
      if (mediaRecorderRef.current) mediaRecorderRef.current.pause();
      setStatus('paused');
      clearInterval(timerRef.current);
    }
  }, [status]);

  const resumeRecording = useCallback(() => {
    if (status === 'paused') {
      if (mediaRecorderRef.current) mediaRecorderRef.current.resume();
      setStatus('recording');
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    }
  }, [status]);

  const startAnalysis = useCallback(async (passageId = null, expectedText = null) => {
    const finalBlob = audioBlob || audioBlobRef.current;

    const isDemo = localStorage.getItem('is_demo_mode') === 'true';

    if (!finalBlob && !isDemo) {
      setAnalysisError('No audio recording found. Please record your voice first before submitting for analysis.');
      setStatus('error');
      return;
    }

    setStatus('processing');
    setAnalysisError(null);

    if (isDemo) {
      setTimeout(() => {
        setSessionId('mock-session-1');
        setAnalysisResults({
          id: 'mock-session-1',
          _id: 'mock-session-1',
          type: 'Evaluation',
          name: 'Vocal Prompt Evaluation',
          fluencyScore: 84
        });
        setStatus('success');
      }, 2500);
      return;
    }

    console.log(`📤 Submitting recording for analysis: ${finalBlob.size} bytes, passageId=${passageId}`);

    try {
      const response = await sessionsService.analyzeSession(finalBlob, passageId, expectedText);
      const sessionData = response.data.session || response.data;

      if (sessionData?._id || sessionData?.id) {
        setSessionId(sessionData._id || sessionData.id);
        setAnalysisResults(sessionData);
        setStatus('success');
      } else {
        throw new Error('Analysis completed but no valid session data returned');
      }
    } catch (err) {
      console.error('Analysis failed:', err);
      setAnalysisError(err.response?.data?.message || err.message || 'Failed to analyze audio');
      setStatus('error');
    }
  }, [audioBlob]);

  const setExternalAudio = useCallback((blob, durationSec = 0) => {
    setAudioBlob(blob);
    audioBlobRef.current = blob;
    setDuration(durationSec);
    setStatus('reviewing');
  }, []);

  const resetRecording = useCallback(() => {
    setStatus('idle');
    setDuration(0);
    setAudioBlob(null);
    setAnalyser(null);
    setSessionId(null);
    setAnalysisResults(null);
    setAnalysisError(null);
    chunksRef.current = [];
    audioBlobRef.current = null;
    hasVoiceRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    // Close AudioContext if it wasn't already closed by stopRecording
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    // Stop any lingering microphone tracks
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  return {
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
  };
};
