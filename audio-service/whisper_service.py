"""
WHISPER SERVICE — Speech-to-Text Transcription
================================================
This module uses OpenAI's Whisper model to convert audio recordings
into text with WORD-LEVEL TIMESTAMPS.

WHY WHISPER?
- Free, open-source, runs locally (no API key needed)
- Supports word-level timestamps (critical for stutter detection)
- Highly accurate even with disfluent speech
- Handles background noise well

MODEL SIZES:
- tiny   (~40MB)  → Fast but less accurate
- base   (~140MB) → Good balance (WE USE THIS)
- small  (~460MB) → Better accuracy, slower
- medium (~1.5GB) → High accuracy, much slower
- large  (~3GB)   → Best accuracy, very slow

HOW IT WORKS:
1. Load the Whisper model (done once at startup)
2. Receive a WAV audio file
3. Whisper processes the audio and returns:
   - Full transcript text
   - Word-by-word breakdown with start/end timestamps
4. These timestamps are critical because they let us:
   - Detect repeated words (same word appearing consecutively)
   - Calculate gaps between words (to find abnormal pauses)
   - Compute speech rate (words per minute)
"""

import whisper
import os
import json
try:
    import librosa
    _LIBROSA_AVAILABLE = True
except ImportError:
    _LIBROSA_AVAILABLE = False

# Global model variable — loaded once, reused for all requests
_model = None


def load_model(model_name="base"):
    """
    Load the Whisper model into memory.
    This is called once when the server starts.
    
    The 'base' model is ~140MB and provides good accuracy
    for stutter detection purposes.
    """
    global _model
    if _model is None:
        print(f"📥 Loading Whisper '{model_name}' model...")
        _model = whisper.load_model(model_name)
        print(f"✅ Whisper '{model_name}' model loaded successfully")
    return _model


def transcribe_audio(audio_path):
    """
    Transcribe an audio file and return word-level timestamps.
    
    Args:
        audio_path (str): Path to the WAV/audio file
        
    Returns:
        dict: {
            'text': 'full transcript text',
            'words': [
                {'word': 'hello', 'start': 0.0, 'end': 0.5},
                {'word': 'world', 'start': 0.6, 'end': 1.1},
                ...
            ],
            'language': 'en',
            'duration': 15.3
        }
    
    EXAMPLE OUTPUT:
    For someone saying "I I I want to go to the the store":
    {
        'text': 'I I I want to go to the the store',
        'words': [
            {'word': 'I',     'start': 0.00, 'end': 0.15},
            {'word': 'I',     'start': 0.25, 'end': 0.40},  ← repeated!
            {'word': 'I',     'start': 0.50, 'end': 0.65},  ← repeated!
            {'word': 'want',  'start': 0.80, 'end': 1.10},
            {'word': 'to',    'start': 1.15, 'end': 1.30},
            {'word': 'go',    'start': 1.35, 'end': 1.55},
            {'word': 'to',    'start': 1.60, 'end': 1.75},
            {'word': 'the',   'start': 1.80, 'end': 1.95},
            {'word': 'the',   'start': 2.30, 'end': 2.45},  ← repeated!
            {'word': 'store', 'start': 2.50, 'end': 2.85}
        ]
    }
    """
    model = load_model()
    
    # Transcribe with word-level timestamps enabled
    # This is the KEY feature — without word_timestamps, we only get
    # segment-level timing which is too coarse for stutter detection
    result = model.transcribe(
        audio_path,
        word_timestamps=True,              # CRITICAL: gives us per-word timing
        language="en",                     # Force English for consistency
        fp16=False,                        # Use FP32 for CPU compatibility
        condition_on_previous_text=False,  # CRITICAL: Prevents Whisper from using context
                                           # to "clean up" repetitions. Without this, 
                                           # "I I I want" becomes "I want"
        suppress_blank=False,              # Don't suppress blank/hesitation tokens
        temperature=0.0,                   # Use greedy decoding for raw accuracy
        no_speech_threshold=0.6,           # Default threshold to prevent hallucinations on silence
        compression_ratio_threshold=3.0,   # Higher tolerance — don't skip "repetitive" segments
        initial_prompt="Umm, let me think... I I I want to go." # Helps anchor the model to English and dysfluent speech, reducing YouTube subtitle hallucinations.
    )
    
    # Extract word-level data from Whisper's output
    words = []
    valid_text_segments = []
    
    for segment in result.get("segments", []):
        # Explicitly drop segments that Whisper is unsure about (silence/noise)
        if segment.get("no_speech_prob", 0.0) > 0.4:
            continue
            
        segment_text = segment.get("text", "").strip()
        valid_text_segments.append(segment_text)
        
        for word_info in segment.get("words", []):
            words.append({
                "word": word_info["word"].strip(),
                "start": round(word_info["start"], 3),
                "end": round(word_info["end"], 3)
            })
            
    final_text = " ".join(valid_text_segments).strip()
    
    # Post-processing: Filter out common Whisper hallucinations for short audio.
    # IMPORTANT: Only match if the ENTIRE transcript is a known hallucination phrase,
    # not if it merely contains one of those words inside legitimate speech.
    # e.g. "Thank you" alone = hallucination  |  "Thank you for attending" = real speech.
    EXACT_HALLUCINATIONS = {
        "thank you", "subscribe", "amara.org", "thanks for watching",
        "bye", "bye bye", "thank you.", "thanks."
    }
    if len(final_text.split()) < 5:
        if final_text.lower().strip(".,!?") in EXACT_HALLUCINATIONS:
            final_text = ""
            words = []

    # Calculate total audio duration from the actual file, not from word timestamps.
    # words[-1]["end"] only measures speech time — silence at the end is excluded,
    # which inflates WPM for recordings where the user pauses before stopping.
    duration = 0.0
    if _LIBROSA_AVAILABLE:
        try:
            duration = librosa.get_duration(path=audio_path)
            duration = round(duration, 2)
        except Exception:
            pass  # fall back to word-end timestamp below

    if duration <= 0:
        if words:
            duration = words[-1]["end"]
        elif result.get("segments"):
            duration = result["segments"][-1]["end"]

    return {
        "text": final_text,
        "words": words,
        "language": result.get("language", "en"),
        "duration": round(duration, 2)
    }


# --- FOR TESTING ---
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        audio_file = sys.argv[1]
        print(f"Transcribing: {audio_file}")
        result = transcribe_audio(audio_file)
        print(f"\nText: {result['text']}")
        print(f"Duration: {result['duration']}s")
        print(f"Words: {len(result['words'])}")
        print("\nWord-level timestamps:")
        for w in result['words']:
            print(f"  [{w['start']:.2f}s - {w['end']:.2f}s] {w['word']}")
    else:
        print("Usage: python whisper_service.py <audio_file.wav>")
