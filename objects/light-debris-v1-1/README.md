# Light & Debris V1.1 — Spatial audio

Based on preserved V1.0 commit 7012380f8a6e9763efaccf3c69bd2564b2b01048. All visual quality and palette presets and existing force solver unchanged. V1.0 remains at its original URL.

- Original procedural Web Audio synthesis: two independently positioned laser voices, soft non-melodic ambient drone/filtered noise, inharmonic short glass chimes.
- Trigger beams sound even if aimed outside the cloud; timbre varies with aim motion and cloud intersection. HRTF spatial panners and head pose listener.
- Glass events are approximate sphere contact onsets, detected from up to 1,536 real GPU fragment position/size samples at up to 8 Hz; approaching relative motion required, per-pair debounce, maximum one new bell per 85 ms and eight simultaneous voices. No fabricated ambient crystal chimes. This is a sampled detector, not exact triangle collision or collision response; some contacts will be missed.
- One asynchronous readback in flight; 24,576 bytes per sample at most, no changes to main visual buffers. If contact readback fails, laser and ambient continue. Performance not benchmarked on Quest.
- Audio unlocked on direct user click (XR entry or Enable audio). Separate master, ambient and effects controls. Session visibility and exit silence audio. No audio files or external services.
- Original inspiration: https://nkondo-ft.github.io/light-and-debris/ ; independent implementation.
- Physical Quest audio and runtime testing pending.
