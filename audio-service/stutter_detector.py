"""
STUTTER DETECTOR — Core Detection Algorithms
==============================================
This module takes the Whisper transcript + raw audio and detects
5 types of stuttering patterns:

1. REPETITIONS   — "I-I-I want" (same word repeated consecutively)
2. PAUSES        — Abnormally long silences mid-sentence (>300ms)
3. FILLERS       — "um", "uh", "like", "you know"
4. SPEECH RATE   — Words per minute (normal: 120-150 WPM)
5. PROLONGATIONS — Extended phonemes like "prrrrrfemue" or "bissssssssstick"

Then combines everything into a FLUENCY SCORE (0-100).

HOW EACH DETECTOR WORKS:
========================

REPETITION DETECTOR:
  Input:  Whisper word list ["I", "I", "I", "want", "to", "the", "the", "store"]
  Logic:  Walk through words. If word[i] == word[i-1], mark as repetition.
  Output: [{word: "I", times: 3, position: 0.0}, {word: "the", times: 2, position: 1.8}]

PAUSE DETECTOR (uses Librosa):
  Input:  Raw audio WAV file
  Logic:  librosa.effects.split() finds all non-silent intervals.
          Gap between intervals > 300ms = abnormal pause.
  Output: [{position: 3.5, duration_ms: 850}, {position: 7.2, duration_ms: 620}]

FILLER DETECTOR:
  Input:  Whisper word list
  Logic:  Check each word against known filler list
  Output: ["um", "uh", "like", "um"]

SPEECH RATE:
  Input:  Word count + total duration
  Logic:  (total_words / duration_minutes)
  Output: 95 WPM

PROLONGATION DETECTOR (uses Librosa):
  Input:  Raw audio WAV file
  Logic:  librosa.effects.split() finds speech segments.
          A segment that is 2.5x+ longer than the average segment duration
          AND longer than 450ms is flagged as a prolonged phoneme.
          This catches "prrrrrfemue" (stretched /r/) and "bissssssssstick" (/s/).
  Output: [{position: 1.2, duration_ms: 700, severity: "high"}]

FLUENCY SCORE:
  Formula: 100 - (repetitions×8) - (prolongations×6) - (pauses×5) - (fillers×3) - (WPM_penalty)
  Output: 66.5 / 100
"""

# pyrefly: ignore [missing-import]
import librosa
import numpy as np

try:
    import stutter_solver_service
    STUTTER_SOLVER_AVAILABLE = True
except ImportError as e:
    print(f"Stutter-Solver not available: {e}")
    STUTTER_SOLVER_AVAILABLE = False


def detect_repetitions(words):
    """
    Detect consecutive word repetitions in the transcript.
    
    Stuttering often manifests as repeating the same word multiple times:
    "I-I-I want" or "the-the store"
    
    Args:
        words (list): List of word dicts from Whisper
                      [{'word': 'I', 'start': 0.0, 'end': 0.15}, ...]
    
    Returns:
        dict: {
            'count': 2,        # number of repetition EVENTS
            'total_repeated': 3, # total extra repeated words
            'repetitions': [
                {'word': 'I', 'times': 3, 'position': 0.0, 'indices': [0,1,2]},
                {'word': 'the', 'times': 2, 'position': 1.8, 'indices': [7,8]}
            ]
        }
    """
    if not words or len(words) < 2:
        return {"count": 0, "total_repeated": 0, "repetitions": []}
    
    repetitions = []
    i = 0
    
    while i < len(words):
        # Get the current word (lowercase, stripped of punctuation)
        current = words[i]["word"].lower().strip(".,!?;:'\"")
        
        # Skip very short words that might be noise
        if len(current) == 0:
            i += 1
            continue
        
        # Count how many times this word repeats consecutively
        repeat_count = 1
        indices = [i]
        j = i + 1
        
        while j < len(words):
            next_word = words[j]["word"].lower().strip(".,!?;:'\"")
            if next_word == current:
                repeat_count += 1
                indices.append(j)
                j += 1
            else:
                break
        
        # If word appeared 2+ times consecutively, it's a repetition
        if repeat_count >= 2:
            repetitions.append({
                "word": current,
                "times": repeat_count,
                "position": words[i]["start"],
                "indices": indices
            })
        
        # Move past the repeated block
        i = j if repeat_count >= 2 else i + 1
    
    # Total extra repetitions (times - 1 for each event, since saying it once is normal)
    total_repeated = sum(r["times"] - 1 for r in repetitions)
    
    return {
        "count": len(repetitions),       # How many repetition EVENTS
        "total_repeated": total_repeated, # Total extra words spoken
        "repetitions": repetitions
    }


def detect_pauses(audio_path, min_pause_duration=0.5, silence_threshold=25, whisper_words=None):
    """
    Detect abnormally long pauses/silences in the audio.

    Normal speech has ~200-300ms pauses between phrases (breathing).
    Pauses > 500ms mid-sentence often indicate a BLOCK (type of stutter).
    Pauses immediately following sentence-ending punctuation (period, question
    mark) are EXCLUDED — those are natural reading pauses, not disfluencies.

    Uses Librosa to find silent intervals in the audio signal.
    Threshold raised to 500ms and 25dB to avoid penalizing normal breathing.
    """
    try:
        # Load audio file
        audio, sr = librosa.load(audio_path, sr=16000)

        # Find non-silent intervals
        # top_db=25 means anything 25dB below the peak is "silence" (more sensitive)
        intervals = librosa.effects.split(audio, top_db=silence_threshold)

        pauses = []

        if len(intervals) < 2:
            return {"count": 0, "total_duration_ms": 0, "pauses": []}

        # Build a set of timestamps (in seconds) that immediately follow
        # sentence-ending words — those pauses are natural reading breaks.
        sentence_end_times = set()
        if whisper_words:
            for w in whisper_words:
                word_text = w.get("word", "").strip()
                if word_text and word_text[-1] in ('.', '?', '!'):
                    # Mark 1.0s window after this word as exempt
                    sentence_end_times.add(round(w["end"], 2))

        for i in range(1, len(intervals)):
            gap_start_sample = intervals[i - 1][1]
            gap_end_sample = intervals[i][0]
            gap_duration = (gap_end_sample - gap_start_sample) / sr

            if gap_duration >= min_pause_duration:
                position = gap_start_sample / sr

                # Skip if this pause starts within 1.0s after a sentence-end word
                is_sentence_pause = any(
                    abs(position - t) <= 1.0 for t in sentence_end_times
                )
                if is_sentence_pause:
                    continue

                pauses.append({
                    "position": round(position, 2),
                    "duration_ms": round(gap_duration * 1000)
                })

        total_duration = sum(p["duration_ms"] for p in pauses)

        return {
            "count": len(pauses),
            "total_duration_ms": total_duration,
            "pauses": pauses
        }

    except Exception as e:
        print(f"❌ Pause detection error: {e}")
        return {"count": 0, "total_duration_ms": 0, "pauses": []}


def detect_audio_level_repetitions(audio_path):
    """
    AUDIO-LEVEL repetition detection using signal analysis.
    
    This catches stutters that Whisper misses by analyzing the raw audio
    for repetitive short speech bursts — the acoustic fingerprint of stuttering.
    
    HOW IT WORKS:
    1. Split audio into short speech segments using librosa
    2. If multiple very short segments (< 400ms) appear close together,
       that's likely a stutter (e.g., "b-b-b-ball")
    3. Also checks for segments with very similar energy profiles
       (repeated syllables sound similar acoustically)
    """
    try:
        audio, sr = librosa.load(audio_path, sr=16000)
        
        # Split into speech segments — use sensitive threshold (top_db=20)
        # top_db=20 means anything 20dB below peak is "silence" (catches quiet bursts)
        intervals = librosa.effects.split(audio, top_db=20)
        
        if len(intervals) < 2:
            return {"count": 0, "repetitions": [], "fragmentation_ratio": 0,
                    "total_segments": len(intervals), "short_segments": 0}
        
        repetitions = []
        
        # Convert intervals to durations and gaps
        segments = []
        for start, end in intervals:
            duration_ms = (end - start) / sr * 1000
            position = start / sr
            segments.append({
                "start": start,
                "end": end,
                "position": position,
                "duration_ms": duration_ms
            })
        
        # PATTERN 1: Detect clusters of very short speech bursts
        # Stuttering creates rapid short bursts: "b-b-b-ball" = 4 short segments
        # Threshold: < 500ms each, gap < 400ms between bursts
        i = 0
        while i < len(segments):
            cluster = []
            j = i
            while j < len(segments):
                seg = segments[j]
                if seg["duration_ms"] < 500:  # Short burst (raised from 400ms)
                    cluster.append(seg)
                    j += 1
                    # Check gap to next segment is small (< 400ms)
                    if j < len(segments):
                        gap = (segments[j]["start"] - seg["end"]) / sr * 1000
                        if gap > 400:
                            break
                else:
                    break
            
            # 2+ short bursts in a row = likely stuttering (lowered from 3)
            if len(cluster) >= 2:
                repetitions.append({
                    "type": "sound_repetition",
                    "position": round(cluster[0]["position"], 2),
                    "burst_count": len(cluster),
                    "details": f"Detected {len(cluster)} rapid speech bursts (likely syllable/word repetition)"
                })
                i = j
            else:
                i += 1
        
        # PATTERN 2: Detect unusually fragmented speech
        # Normal speech: few long segments. Stuttered speech: many short segments
        short_segments = [s for s in segments if s["duration_ms"] < 300]
        total_segments = len(segments)
        fragmentation_ratio = len(short_segments) / total_segments if total_segments > 0 else 0
        
        if fragmentation_ratio > 0.35 and total_segments > 4:
            repetitions.append({
                "type": "fragmented_speech",
                "position": 0,
                "burst_count": len(short_segments),
                "details": f"Speech is highly fragmented ({int(fragmentation_ratio*100)}% short bursts) — indicates disfluency"
            })
        
        return {
            "count": len(repetitions),
            "repetitions": repetitions,
            "fragmentation_ratio": round(fragmentation_ratio, 2),
            "total_segments": total_segments,
            "short_segments": len(short_segments)
        }
    
    except Exception as e:
        print(f"❌ Audio-level repetition detection error: {e}")
        return {"count": 0, "repetitions": [], "fragmentation_ratio": 0,
                "total_segments": 0, "short_segments": 0}


def detect_prolongations(audio_path):
    """
    Detect PROLONGED phonemes — the "prrrrrfemue" and "bissssssssstick" pattern.

    HOW IT WORKS:
    ─────────────
    In normal speech, each phoneme or syllable lasts roughly 50–250ms.
    When a speaker stutters by PROLONGING a sound (stretching /r/, /s/, /b/)
    the acoustic signal shows a single continuous non-silent segment that is
    unusually LONG compared to normal syllable duration.

    Algorithm:
      1. Split audio into speech segments using librosa.
      2. Compute the median segment duration (baseline for this speaker).
      3. Any segment longer than max(450ms, 2.5 × median) is a prolongation.
      4. Severity is rated: moderate (450–700ms), high (>700ms).

    Returns:
        dict: {
            'count': 2,
            'prolongations': [
                {'position': 1.2, 'duration_ms': 680, 'severity': 'moderate'},
                {'position': 3.8, 'duration_ms': 920, 'severity': 'high'}
            ]
        }
    """
    try:
        audio, sr = librosa.load(audio_path, sr=16000)
        
        # Use sensitive split — top_db=20 catches quieter speech
        intervals = librosa.effects.split(audio, top_db=20)
        
        if len(intervals) == 0:
            return {"count": 0, "prolongations": []}
        
        # Compute segment info
        segments = []
        for start, end in intervals:
            duration_ms = (end - start) / sr * 1000
            position = start / sr
            segments.append({
                "start": start,
                "end": end,
                "position": position,
                "duration_ms": duration_ms
            })
        
        # Baseline: median duration of all segments
        durations = [s["duration_ms"] for s in segments]
        median_dur = float(np.median(durations)) if durations else 200.0
        
        # Threshold: 2.5x median OR absolute floor of 450ms
        threshold_ms = max(450.0, 2.5 * median_dur)
        
        prolongations = []
        for seg in segments:
            if seg["duration_ms"] >= threshold_ms:
                if seg["duration_ms"] >= 700:
                    severity = "high"
                else:
                    severity = "moderate"
                prolongations.append({
                    "position": round(seg["position"], 2),
                    "duration_ms": round(seg["duration_ms"]),
                    "severity": severity,
                    "details": f"Prolonged phoneme: {round(seg['duration_ms'])}ms segment (threshold: {round(threshold_ms)}ms)"
                })
        
        return {
            "count": len(prolongations),
            "prolongations": prolongations,
            "median_segment_ms": round(median_dur)
        }
    
    except Exception as e:
        print(f"❌ Prolongation detection error: {e}")
        return {"count": 0, "prolongations": [], "median_segment_ms": 0}


def detect_fillers(words):
    """
    Detect filler words / interjections in the transcript.
    
    Filler words like "um", "uh", "er" are common disfluencies.
    Excessive use indicates speech anxiety or difficulty.
    
    Note: "like" is tricky — "I like cats" is valid, but 
    "it was like um" is a filler. For simplicity, we count all instances
    but flag it in the NLP layer for context-aware filtering.
    
    Args:
        words (list): List of word dicts from Whisper
    
    Returns:
        dict: {
            'count': 4,
            'fillers': ['um', 'uh', 'like', 'um'],
            'positions': [2.3, 5.1, 7.8, 11.2]
        }
    """
    FILLER_WORDS = {
        "um", "uh", "er", "ah", "eh",
        "hmm", "hm", "mm",
        "like",      # context-dependent (filtered in NLP layer)
        "basically", 
        "actually",  # when overused
        "literally",
        "you know",
        "i mean",
        "sort of",
        "kind of"
    }
    
    detected_fillers = []
    positions = []
    
    for word_info in words:
        word = word_info["word"].lower().strip(".,!?;:'\"")
        if word in FILLER_WORDS:
            detected_fillers.append(word)
            positions.append(word_info["start"])
    
    return {
        "count": len(detected_fillers),
        "fillers": detected_fillers,
        "positions": positions
    }


def calculate_speech_rate(words, duration):
    """
    Calculate words per minute (WPM).
    
    Normal adult speech rate: 120-150 WPM
    Disfluent speech:         < 100 WPM (due to pauses, repetitions)
    Fast speech:              > 160 WPM
    
    We exclude repeated words and fillers from the count to get
    the "effective" speech rate — how fast they communicate meaning.
    
    Args:
        words (list): List of word dicts from Whisper
        duration (float): Total audio duration in seconds
    
    Returns:
        dict: {
            'wpm': 95,
            'total_words': 45,
            'effective_words': 38,  # excluding repetitions/fillers
            'duration_minutes': 0.47,
            'assessment': 'below_normal'  # below_normal, normal, above_normal
        }
    """
    if not words or duration <= 0:
        return {
            "wpm": 0, "total_words": 0, "effective_words": 0,
            "duration_minutes": 0, "assessment": "insufficient_data"
        }
    
    total_words = len(words)
    duration_minutes = duration / 60.0
    
    # Raw WPM (including all words)
    raw_wpm = total_words / duration_minutes if duration_minutes > 0 else 0
    
    # Assess the speech rate
    if raw_wpm < 100:
        assessment = "below_normal"
    elif raw_wpm <= 160:
        assessment = "normal"
    else:
        assessment = "above_normal"
    
    return {
        "wpm": round(raw_wpm),
        "total_words": total_words,
        "effective_words": total_words,  # refined after repetition removal
        "duration_minutes": round(duration_minutes, 2),
        "assessment": assessment
    }


def merge_transcript_and_stutters(whisper_words, stutters):
    """
    Map Stutter-Solver's precise timestamp dysfluencies to the actual words
    from the Whisper transcript.
    """
    merged_events = []
    for stutter in stutters:
        # find overlapping words
        overlapping = [w["word"] for w in whisper_words if not (w["end"] < stutter["start"] or w["start"] > stutter["end"])]
        
        # If no strict overlap, find the closest word
        if not overlapping and whisper_words:
            closest_word = min(whisper_words, key=lambda w: abs(w["start"] - stutter["start"]))
            overlapping = [closest_word["word"]]
            
        word_text = " ".join(overlapping) if overlapping else "[silence]"
        merged_events.append({
            "type": stutter["type"],
            "word": word_text,
            "position": stutter["start"],
            "details": f"{stutter['type'].capitalize()} detected ({int(stutter['confidence'] * 100)}%)"
        })
    return merged_events


def calculate_fluency_score(repetition_data, pause_data, filler_data, speech_rate_data, audio_repetition_data=None, advanced_stutters=None, prolongation_data=None):
    """
    Calculate a composite fluency score from 0 to 100.

    Penalty table:
      Word repetitions  : -8 per event
      Audio repetitions : -6 per event
      Prolongations     : -6 (moderate) / -8 (high) per event
      Pauses            : -5 per pause  (only pauses NOT already covered by a Stutter-Solver block)
      Fillers           : -3 per filler
      Fragmentation     : -5 or -10 depending on ratio
      WPM penalty       : scaled

    FIX: When Stutter-Solver detects blocks, those silences are already
    accounted for in the advanced_blocks penalty. We de-duplicate against
    pause_data so the same silence is not counted twice.
    """
    score = 100.0

    # Collect timestamps of Stutter-Solver block events (±0.5s tolerance)
    block_timestamps = []
    if advanced_stutters:
        for s in advanced_stutters:
            if s["type"] == "block":
                block_timestamps.append(s["start"])

    # De-duplicate pause_data against block_timestamps
    def _pause_is_covered_by_block(pause_pos):
        return any(abs(pause_pos - bt) <= 0.5 for bt in block_timestamps)

    if advanced_stutters:
        advanced_reps = len([s for s in advanced_stutters if s["type"] == "repetition"])
        advanced_blocks = len([s for s in advanced_stutters if s["type"] == "block"])
        advanced_prolong = len([s for s in advanced_stutters if s["type"] == "prolongation"])

        score -= advanced_reps * 8
        score -= advanced_blocks * 10
        score -= advanced_prolong * 6
    else:
        # Penalty for word-level repetitions (-8 per event)
        score -= repetition_data["count"] * 8

        # Penalty for audio-level repetitions (-6 per event)
        if audio_repetition_data:
            score -= audio_repetition_data.get("count", 0) * 6
            frag_ratio = audio_repetition_data.get("fragmentation_ratio", 0)
            if frag_ratio > 0.4:
                score -= 10
            elif frag_ratio > 0.25:
                score -= 5

    # Penalty for prolonged phonemes — skip events already captured by Stutter-Solver
    if prolongation_data:
        solver_prolong_times = [
            s["start"] for s in (advanced_stutters or []) if s["type"] == "prolongation"
        ]
        for p in prolongation_data.get("prolongations", []):
            already_counted = any(abs(p["position"] - t) <= 0.5 for t in solver_prolong_times)
            if already_counted:
                continue
            if p["severity"] == "high":
                score -= 8
            else:
                score -= 6

    # Penalty for abnormal pauses (-5 per pause, skipping those already penalized as blocks)
    uncovered_pauses = [
        p for p in pause_data["pauses"]
        if not _pause_is_covered_by_block(p["position"])
    ]
    score -= len(uncovered_pauses) * 5

    if sum(p["duration_ms"] for p in uncovered_pauses) > 3000:
        score -= 5

    # Penalty for fillers (-3 per filler)
    score -= filler_data["count"] * 3

    # Penalty for abnormal speech rate
    wpm = speech_rate_data["wpm"]
    if wpm > 0 and wpm < 100:
        score -= (100 - wpm) / 5
    elif wpm > 180:
        score -= (wpm - 180) / 10

    # Clamp between 0 and 100
    score = max(0, min(100, score))
    
    return round(score, 1)


def analyze_audio(audio_path, transcript_data):
    """
    MAIN FUNCTION — Run all detection algorithms on an audio recording.
    """
    words = transcript_data.get("words", [])
    duration = transcript_data.get("duration", 0)
    transcript_text = transcript_data.get("text", "")
    
    advanced_stutters = []
    if STUTTER_SOLVER_AVAILABLE:
        print("Running Advanced Stutter-Solver AI...")
        advanced_stutters = stutter_solver_service.predict_stutters(audio_path, transcript_text)
    
    # Run text-based detectors (from Whisper transcript)
    repetition_data = detect_repetitions(words)
    filler_data = detect_fillers(words)
    speech_rate_data = calculate_speech_rate(words, duration)
    
    # Run audio-based detectors (from raw audio signal)
    pause_data = detect_pauses(audio_path, whisper_words=words)
    audio_rep_data = detect_audio_level_repetitions(audio_path)
    prolongation_data = detect_prolongations(audio_path)  # NEW: catch prrrr / bisssss
    
    print(f"   📊 Text repetitions: {repetition_data['count']}")
    print(f"   📊 Audio repetitions: {audio_rep_data['count']}")
    print(f"   📊 Prolongations: {prolongation_data['count']} (median seg: {prolongation_data.get('median_segment_ms', 0)}ms)")
    if advanced_stutters:
        print(f"   📊 Advanced Stutter-Solver events: {len(advanced_stutters)}")
    print(f"   📊 Fragmentation: {audio_rep_data.get('fragmentation_ratio', 0):.0%}")
    print(f"   📊 Pauses: {pause_data['count']}")
    print(f"   📊 Fillers: {filler_data['count']}")
    
    total_repetition_count = max(repetition_data["count"], audio_rep_data["count"])
    if advanced_stutters:
        total_repetition_count = max(total_repetition_count, len([s for s in advanced_stutters if s["type"] == "repetition"]))
    
    # Calculate composite fluency score with ALL data
    fluency_score = calculate_fluency_score(
        repetition_data, pause_data, filler_data, speech_rate_data,
        audio_rep_data, advanced_stutters, prolongation_data
    )
    
    # Build the complete metrics object
    metrics = {
        "fluencyScore": fluency_score,
        "speechRateWPM": speech_rate_data["wpm"],
        "speechRateAssessment": speech_rate_data["assessment"],
        "repetitionCount": total_repetition_count,
        "pauseCount": pause_data["count"],
        "fillerCount": filler_data["count"],
        "prolongationCount": prolongation_data["count"],
        "repetitions": [
            {
                "word": r["word"],
                "times": r["times"],
                "position": r["position"]
            }
            for r in repetition_data["repetitions"]
        ],
        "audioRepetitions": audio_rep_data.get("repetitions", []),
        "prolongations": prolongation_data.get("prolongations", []),
        "fragmentationRatio": audio_rep_data.get("fragmentation_ratio", 0),
        "pauses": pause_data["pauses"],
        "fillers": filler_data["fillers"],
        "totalWords": speech_rate_data["total_words"],
        "durationSeconds": duration,
        "detectedStutters": _build_stutter_timeline(
            repetition_data, pause_data, filler_data, audio_rep_data,
            advanced_stutters, words, prolongation_data
        )
    }
    
    return metrics


def _build_stutter_timeline(repetition_data, pause_data, filler_data, audio_rep_data=None, advanced_stutters=None, whisper_words=None, prolongation_data=None):
    """
    Build a unified timeline of all detected stuttering events.
    Includes: repetitions, audio-level bursts, prolongations, pauses, fillers.
    """
    timeline = []
    
    if advanced_stutters and whisper_words is not None:
        timeline.extend(merge_transcript_and_stutters(whisper_words, advanced_stutters))
    else:
        for r in repetition_data["repetitions"]:
            timeline.append({
                "type": "repetition",
                "word": r["word"],
                "position": r["position"],
                "details": f"Repeated {r['times']} times"
            })
        
        if audio_rep_data:
            for ar in audio_rep_data.get("repetitions", []):
                timeline.append({
                    "type": "repetition",
                    "word": f"[{ar['type']}]",
                    "position": ar["position"],
                    "details": ar["details"]
                })
    
    # Add prolongation events — these catch "prrrrrfemue" and "bissssssssstick"
    if prolongation_data:
        for p in prolongation_data.get("prolongations", []):
            # Try to associate with a nearby Whisper word if available
            word_label = None
            if whisper_words:
                nearby = [w for w in whisper_words
                          if abs(w["start"] - p["position"]) < 0.5]
                if nearby:
                    word_label = nearby[0]["word"]
            timeline.append({
                "type": "prolongation",
                "word": word_label or "[prolonged sound]",
                "position": p["position"],
                "details": p["details"],
                "severity": p["severity"]
            })
    
    for p in pause_data["pauses"]:
        timeline.append({
            "type": "pause",
            "word": None,
            "position": p["position"],
            "details": f"Pause of {p['duration_ms']}ms"
        })
    
    for i, filler in enumerate(filler_data["fillers"]):
        position = filler_data["positions"][i] if i < len(filler_data["positions"]) else 0
        timeline.append({
            "type": "filler",
            "word": filler,
            "position": position,
            "details": f"Filler word: {filler}"
        })
    
    # Sort by position in audio
    timeline.sort(key=lambda x: x["position"])
    
    return timeline


# --- FOR TESTING ---
if __name__ == "__main__":
    # Test with mock data
    mock_words = [
        {"word": "I", "start": 0.0, "end": 0.15},
        {"word": "I", "start": 0.25, "end": 0.40},
        {"word": "I", "start": 0.50, "end": 0.65},
        {"word": "want", "start": 0.80, "end": 1.10},
        {"word": "to", "start": 1.15, "end": 1.30},
        {"word": "um", "start": 1.40, "end": 1.55},
        {"word": "go", "start": 1.70, "end": 1.90},
        {"word": "to", "start": 2.00, "end": 2.15},
        {"word": "the", "start": 2.20, "end": 2.35},
        {"word": "the", "start": 2.80, "end": 2.95},
        {"word": "store", "start": 3.00, "end": 3.30},
    ]
    
    print("=== STUTTER DETECTION TEST ===\n")
    
    rep = detect_repetitions(mock_words)
    print(f"Repetitions: {rep['count']} events, {rep['total_repeated']} extra words")
    for r in rep["repetitions"]:
        print(f"  '{r['word']}' repeated {r['times']}x at {r['position']}s")
    
    fill = detect_fillers(mock_words)
    print(f"\nFillers: {fill['count']} — {fill['fillers']}")
    
    rate = calculate_speech_rate(mock_words, 3.3)
    print(f"\nSpeech Rate: {rate['wpm']} WPM ({rate['assessment']})")
    
    score = calculate_fluency_score(rep, {"count": 1, "total_duration_ms": 600, "pauses": []}, fill, rate)
    print(f"\nFluency Score: {score}/100")
