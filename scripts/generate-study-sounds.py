"""Generate the project's original short study-feedback sounds; no stock audio."""
from pathlib import Path
import math
import struct
import wave

destination = Path(__file__).resolve().parent.parent / 'miniprogram/packageEnglish/assets/audio'
destination.mkdir(parents=True, exist_ok=True)
sample_rate = 22050
for filename, duration, positive in [('correct.wav', .28, True), ('retry.wav', .24, False)]:
    samples = []
    for index in range(round(duration * sample_rate)):
        t = index / sample_rate
        envelope = min(1, t / .008) * math.exp(-12 * t) * min(1, (duration - t) / .018)
        frequency = 1318.51 if positive else 440 - 180 * t / duration
        # A gentle bell for correct answers; a soft descending tone for retries.
        phase = 2 * math.pi * (frequency * t if positive else 440 * t - 90 * t * t / duration)
        value = (.7 * math.sin(phase) + .3 * math.sin(2.7 * phase)) * envelope * .48
        samples.append(struct.pack('<h', round(value * 32767)))
    with wave.open(str(destination / filename), 'wb') as sound:
        sound.setparams((1, 2, sample_rate, len(samples), 'NONE', 'not compressed'))
        sound.writeframes(b''.join(samples))
    print(filename, (destination / filename).stat().st_size, 'bytes')
