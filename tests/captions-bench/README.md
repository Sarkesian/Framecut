# Caption quality benchmark

Repeatable measurement of FrameCut's automatic captions: accuracy, invented words on audio without
speech, word timing and speed. Results below are from an RTX 4090 / 32 GB RAM on 2026-11-08.

## Cases (`build.py`, ~27 min of audio)

| | Case | Source |
|---|---|---|
| 01 | Clean narration | LibriSpeech (CC BY 4.0), 8 speakers' utterances |
| 02 | Conversation, accents | Earnings-22 company call (CC BY-SA 4.0) |
| 10a | Accented speech | Earnings-22, second call |
| 03 | Quiet speech | 01 at −42 dBFS |
| 04 | Speech over loud music | 01 + synthwave 3 dB under the voice |
| 17 | Speech over quiet music | 01 + piano 16 dB under |
| 05 | Instrumental | Piano (Jamendo, CC BY) |
| 06 | Electronic / synth | 3 synthwave tracks (Freesound, CC0) |
| 07 | Game sound effects | Explosions, gunfire, lasers over an ambient bed |
| 08 | Silence | Digital silence + −70 dB noise |
| 16 | Orchestral with choir pads | Freesound CC0 |
| 11 | Song with vocals | Jamendo rock track (lyrics; no reference text) |
| 09 | Rapid speech | Windows TTS at +6 rate, exact word timing |
| 10b | Uncommon words / names | TTS: FrameCut, Kubernetes, Siobhan Nguyen, Xerath… |
| 14 | Intentional pauses | TTS with 2.5–4 s pauses |
| 15 | Script realignment | TTS; written script differs from what was said |
| 12 | Multiple speakers | LibriSpeech speakers + two TTS voices |
| 13 | Long recording | All 73 LibriSpeech utterances (9 min) + piano bed |

Run: `python build.py <bench> <ffmpeg>` → `python run_models.py <bench> <engine>` / `python run_pipeline.py <bench> best|fast`
/ `node run_app_baseline.cjs <bench>` (original in-app captioner) → `python score.py <bench>`.
Scoring uses one normalizer for every engine (Mr./mister, numbers, UK/US spelling), so formatting
choices don't count as recognition errors.

## Results

| Engine | WER (pooled) | Invented words on speech-free audio | Words outside speech | Word timing error | Time / audio |
|---|---|---|---|---|---|
| **FrameCut Best** (Qwen3-ASR 1.7B + ForcedAligner, speech/music analysis, checks, Parakeet verification) | **4.4%** | **0** | **0** | **28.5 ms** | 0.12× |
| **FrameCut Fast** (Qwen3-ASR 0.6B + ForcedAligner, same analysis, no verification) | 5.5% | 0 | 0 | 26.7 ms | 0.10× |
| Parakeet TDT 0.6B v2 (+VAD) | 5.8% | 0 | 0 | 80.8 ms | 0.07× |
| Qwen3-ASR 1.7B (raw, whole file) | 6.1% | 0 | 0 | 25.9 ms | 0.05× |
| Parakeet TDT 0.6B v3 (+VAD) | 6.4% | 0 | 0 | 96.5 ms | 0.06× |
| Whisper large-v3 (faster-whisper) | 6.8% | 26 | 18 | 144.7 ms | 0.10× |
| Whisper large-v3 + Silero VAD + strict decoding | 6.8% | 0 | 0 | 130.6 ms | 0.03× |
| Qwen3-ASR 0.6B (raw) | 8.9% | 0 | 0 | 26.3 ms | 0.06× |
| Whisper base (faster-whisper) | 9.8% | 0 | 0 | 106.5 ms | 0.03× |
| **Previous FrameCut** (Whisper base in the editor, transformers.js) | 10.9% | **1908** | 0 | 156.4 ms | 0.32× |

Per case WER (%):

| Engine | 01 | 02 | 10a | 03 | 04 | 17 | 09 | 10b | 14 | 15 | 12 | 13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FrameCut Best | 2.0 | 10.3 | 11.9 | 2.0 | 4.0 | 3.0 | 0.0 | 17.2 | 0.0 | 0.0 | 3.2 | 3.6 |
| Previous FrameCut | 7.5 | 20.0 | 15.3 | 8.0 | 14.5 | 9.5 | 2.8 | 34.5 | 0.0 | 0.0 | 11.1 | 9.7 |

What the previous captioner wrote on speech-free audio (sample): piano → “a little bit more of a little bit
more of …” (773 words); synth → “I'm gonna go back to the …” (686); orchestral → 444 words; silence → “you”.

Song with vocals (lyrics are captioned when “Include song lyrics” is on, the default): Best captioned 91
sung words, 16 marked for review where the second engine could not confirm them; with lyrics off, 0.

## Why these choices

- **Qwen3-ASR 1.7B** had the best accuracy on accented conversation (02: 10.3% in the pipeline vs 39–45% for
  Parakeet, 26–40% for Whisper large-v3) and invented nothing on music, even without a VAD.
- **Qwen3-ForcedAligner** gives the tightest word timing (≈26–30 ms vs 80–145 ms), which word-pop needs.
- **Region-only recognition** (Silero VAD + AudioSet classifier) improved Qwen from 6.1% to 4.4% WER and keeps
  speech separate from instrumental music; the classifier's speech score is 0.59–0.85 for speech even under
  loud music, 0.07 for singing and ≤0.03 for instrumental audio.
- **Parakeet TDT v3** is an independent second opinion on flagged words (fast on CPU, different architecture).
- Whisper large-v3 needed a VAD to stop inventing words and still had the loosest timing; Parakeet is very
  accurate on clean read speech but deleted large parts of real conversation.

Limitations: the benchmark is English-heavy; accents come from one dataset; lyric accuracy has no
reference transcript; TTS cases are easier than real voices. GPU memory in use: ~7 GB during Best.
