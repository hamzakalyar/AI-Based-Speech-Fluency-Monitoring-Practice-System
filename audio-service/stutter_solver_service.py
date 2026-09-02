import os
import sys
import torch
from torch import nn
import librosa

# Add stutter-solver to path so utils can be imported
current_dir = os.path.dirname(os.path.abspath(__file__))
stutter_solver_dir = os.path.join(current_dir, "Stutter-Solver", "stutter-solver")
if stutter_solver_dir not in sys.path:
    sys.path.append(stutter_solver_dir)

import utils.vits.utils as utils
from utils.vits.models import SynthesizerTrn
from utils.vits.text.symbols import symbols
from utils.vits.text import text_to_sequence
import utils.vits.commons as commons
from utils.vits.mel_processing import spectrogram_torch

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

_hps = None
_net_g = None
_decoder = None


def _torch_load_checkpoint(checkpoint_path, map_location):
    try:
        return torch.load(checkpoint_path, map_location=map_location, weights_only=False)
    except TypeError:
        return torch.load(checkpoint_path, map_location=map_location)

def load_stutter_solver_models():
    global _hps, _net_g, _decoder
    if _net_g is not None and _decoder is not None:
        return
    
    try:
        print("Loading Stutter-Solver models into memory...")
        config_path = os.path.join(stutter_solver_dir, "utils", "vits", "configs", "ljs_base.json")
        _hps = utils.get_hparams_from_file(config_path)
        
        _net_g = SynthesizerTrn(
            len(symbols),
            _hps.data.filter_length // 2 + 1,
            _hps.train.segment_size // _hps.data.hop_length,
            **_hps.model).to(device)
        _net_g.eval()
        
        pretrained_path = os.path.join(current_dir, "Stutter-Solver", "saved_models", "pretrained_ljs.pth")
        utils.load_checkpoint(pretrained_path, _net_g, None)
        
        decoder_path = os.path.join(current_dir, "Stutter-Solver", "saved_models", "stutter_solver.pth")
        _decoder = _torch_load_checkpoint(decoder_path, map_location=device)
        _decoder.eval()
        print("Stutter-Solver models loaded successfully.")
    except Exception as e:
        print(f"⚠️  ERROR loading Stutter-Solver models: {e}. Falling back to basic detection.")
        _net_g = None
        _decoder = None

def _sanitize_text_for_vits(text):
    """
    Remove characters not in the VITS symbol set to prevent KeyError.
    The VITS model only knows: _pad + punctuation (;:,.!?¡¿—…\"«»"" ) + letters (A-Za-z) + IPA.
    Characters like hyphens '-', digits '0-9', brackets, etc. will cause crashes.
    """
    import re
    # Build the allowed character set from the symbols list
    allowed = set(symbols)
    # Replace common unsupported characters with safe alternatives
    text = text.replace('-', ' ')
    text = text.replace('–', ' ')
    text = text.replace('—', ' ')  # em-dash is in symbols but en-dash is not
    text = text.replace('/', ' ')
    text = text.replace('(', ' ')
    text = text.replace(')', ' ')
    text = text.replace('[', ' ')
    text = text.replace(']', ' ')
    text = text.replace('{', ' ')
    text = text.replace('}', ' ')
    text = text.replace('&', ' and ')
    text = text.replace('@', ' at ')
    text = text.replace('#', ' ')
    text = text.replace('$', ' ')
    text = text.replace('%', ' percent ')
    text = text.replace('+', ' plus ')
    text = text.replace('=', ' ')
    text = text.replace('*', ' ')
    text = text.replace('~', ' ')
    text = text.replace('`', ' ')
    text = text.replace('^', ' ')
    text = text.replace('|', ' ')
    text = text.replace('\\', ' ')
    text = text.replace('<', ' ')
    text = text.replace('>', ' ')
    # Replace digits with their word equivalents
    digit_words = {'0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
                   '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'}
    for digit, word in digit_words.items():
        text = text.replace(digit, f' {word} ')
    # Final pass: strip any remaining characters not in the allowed set
    cleaned = []
    for ch in text:
        if ch in allowed:
            cleaned.append(ch)
        else:
            cleaned.append(' ')  # replace unknown chars with space
    text = ''.join(cleaned)
    # Collapse multiple spaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def get_text(text, hps):
    text = _sanitize_text_for_vits(text)
    text_norm = text_to_sequence(text, hps.data.text_cleaners)
    if hps.data.add_blank:
        text_norm = commons.intersperse(text_norm, 0)
    text_norm = torch.LongTensor(text_norm)
    return text_norm

def get_audio_spec(filename):
    _sampling_rate = 22050
    _max_wav_value = 32768.0
    _filter_length = 1024
    _hop_length = 256
    _win_length = 1024

    audio, _ = librosa.load(filename, sr=_sampling_rate, mono=True)
    audio = torch.from_numpy(audio).float()

    peak = torch.max(torch.abs(audio))
    if peak > 0:
        audio = audio / peak

    audio = audio * 32767
    audio_norm = (audio / _max_wav_value).unsqueeze(0).to(device)

    spec = spectrogram_torch(
        audio_norm,
        _filter_length,
        _sampling_rate,
        _hop_length,
        _win_length,
        center=False,
    )
    spec = torch.squeeze(spec, 0)
    return spec

def predict_stutters(audio_path, transcript_text):
    """
    Runs Stutter-Solver inference to detect dysfluencies in audio given the transcript.
    Returns a list of dicts: {"type": str, "start": float, "end": float, "confidence": float}
    """
    try:
        load_stutter_solver_models()
    except Exception as e:
        print(f"⚠️  Stutter-Solver models load check failed: {e}")
        return []
        
    if _net_g is None or _decoder is None or _hps is None:
        return []
        
    if not transcript_text.strip():
        return []
        
    try:
        spec = get_audio_spec(audio_path)
        
        stn_tst = get_text(transcript_text, _hps)
        x_tst = stn_tst.unsqueeze(0).to(device)
        x_tst_lengths = torch.LongTensor([stn_tst.size(0)]).to(device)
        
        y = spec.unsqueeze(0).to(device)
        y_lengths = torch.LongTensor([y.shape[-1]]).to(device)
        
        with torch.no_grad():
            o, l_length, (neg_cent, attn), ids_slice, x_mask, y_mask, _ = _net_g(x_tst, x_tst_lengths, y, y_lengths)
            soft_attention = nn.functional.softmax(neg_cent, dim=-1)
    
        # Pad soft_attention to [batch, 1024, 768] expected by decoder
        pad_dim1 = 768 - soft_attention.shape[-1]
        pad_dim2 = 1024 - soft_attention.shape[-2]
        
        if pad_dim1 < 0:
            soft_attention = soft_attention[:, :, :768]
            pad_dim1 = 0
        if pad_dim2 < 0:
            soft_attention = soft_attention[:, :1024, :]
            pad_dim2 = 0
            
        soft_attention = nn.functional.pad(soft_attention, (0, pad_dim1, 0, pad_dim2))
        
        num_regions = int(spec.shape[-1] // 16)
        mask = torch.ones((1, 64), dtype=torch.bool).to(device)
        max_region = min(num_regions, 63)
        mask[0, :max_region + 1] = False
        
        with torch.no_grad():
            output = _decoder(soft_attention, mask)
            
        stutters = []
        labels = ["repetition", "block", "missing", "replace", "prolongation"]

        # Get actual audio duration for clamping.
        # The hard-coded frame math (start_norm * 1024 * 256 / 22050) assumes the
        # attention matrix is exactly 1024 frames, which is only true for ~12s clips.
        # For shorter recordings, the matrix is smaller and timestamps overshoot.
        try:
            actual_duration = librosa.get_duration(path=audio_path)
        except Exception:
            actual_duration = float("inf")

        for i in range(max_region):
            exists_pred = torch.clamp(output[0, i, 2], 0, 1)
            if exists_pred > 0.5:
                disf_type_pred = output[0, i, 3:]
                type_idx = torch.argmax(disf_type_pred).item()
                start_norm = output[0, i, 0].item()
                end_norm = output[0, i, 1].item()

                start_sec = (start_norm * 1024 * 256) / 22050
                end_sec = (end_norm * 1024 * 256) / 22050

                # Clamp to valid audio range and discard out-of-bounds events
                start_sec = round(max(0.0, min(start_sec, actual_duration)), 2)
                end_sec = round(max(start_sec, min(end_sec, actual_duration)), 2)
                if start_sec >= actual_duration:
                    continue

                stutters.append({
                    "type": labels[type_idx],
                    "start": start_sec,
                    "end": end_sec,
                    "confidence": round(exists_pred.item(), 2)
                })
                
        return stutters
    except Exception as e:
        print(f"⚠️  Stutter-Solver inference failed: {e}. Falling back to basic detection.")
        return []
