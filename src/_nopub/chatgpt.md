# Earthquake Sonification via WebAudio

For an earthquake sonification, I’d avoid thinking of it as simply 
“a very low oscillator.” A convincing rumble usually comes from 
**broadband energy shaped into the low frequencies**, combined with 
a few resonances and slow, irregular modulation.

A good Web Audio architecture is roughly:

```text
                     ┌─> resonant bandpass ~25–50 Hz ─┐
noise ─> lowpass ────┼─> resonant bandpass ~60–100 Hz ├─> sum ─> distortion ─> compressor ─> output
                     └─> lowpass <150–250 Hz ─────────┘
                                      ↑
                               slow modulation

low oscillator(s) ────────────────────┘
```

The most useful building blocks are these:

* **Noise → `BiquadFilterNode`**: probably the most important ingredient. 
  Pink/brown-ish noise low-passed around 100–250 Hz sounds much more geological 
  than a sine wave.
* **Several `BiquadFilterNode`s with resonance**: create broad resonant regions, 
  perhaps around 30, 55, 85, and 130 Hz. Don't make them too narrow or you'll 
  hear pitches instead of rumble.
* **Very low oscillators**: sine/triangle oscillators around 20–60 Hz can add 
  physical weight underneath the noise. Slightly detune multiple oscillators 
  rather than using one huge sine.
* **`WaveShaperNode`**: mild saturation is extremely useful. It generates 
  harmonics from frequencies that laptop speakers otherwise can't reproduce.
* **`DynamicsCompressorNode`**: keeps transient peaks under control while 
  allowing you to push the signal into a dense, heavy texture.
* **Slow modulation of gain/filter frequency**: this is what makes it feel 
  like moving earth rather than HVAC noise.

For example, I'd experiment with a signal containing roughly:

```text
brown noise
    ↓
LPF ~180 Hz
    ↓
+ resonances at 32, 58, 95 Hz
    ↓
slow gain fluctuations (~0.2–3 Hz)
    ↓
soft saturation
    ↓
compressor
```

One particularly effective technique for earthquakes is **modulating the 
spectrum rather than merely the amplitude**. For example, take a resonant
low-pass:

```js
const filter = new BiquadFilterNode(ctx, {
  type: "lowpass",
  frequency: 120,
  Q: 1.5
});
```

and slowly drive `filter.frequency` between perhaps 60–200 Hz from your 
earthquake data. That creates the impression of large masses shifting because 
the *character* of the noise changes rather than merely getting louder.

I'd also consider separating your earthquake data into different perceptual 
dimensions. For example:

| Earthquake property        | Sonic mapping                         |
| -------------------------- | ------------------------------------- |
| magnitude / energy         | overall gain + saturation             |
| instantaneous acceleration | noise amplitude                       |
| dominant seismic frequency | filter/resonance frequency            |
| depth                      | spectral darkness / LPF cutoff        |
| distance                   | gain + high-frequency attenuation     |
| P/S-wave arrival           | distinct transient/envelope events    |
| long-period movement       | sub-bass oscillator / slow modulation |

One thing I'd **strongly recommend** is deliberately generating some energy in 
the **80–200 Hz range even if the seismic phenomenon you're representing is 
much lower**. A 15 Hz oscillator may be scientifically meaningful, but most 
headphones and speakers will barely reproduce it. Saturation can help here:

```js
sub oscillator, 25 Hz
       ↓
WaveShaper
       ↓
25 Hz + harmonics at 50, 75, 100, 125 Hz...
```

That lets the listener *perceive* something corresponding to the infrasonic 
component without simply translating everything upward.

You can make an inexpensive soft saturator with a `WaveShaperNode` curve 
based on something like:

```js
y = Math.tanh(drive * x);
```

For your particular project, though, I think an even more interesting approach 
would be **two layers**:

```text
"GEOLOGICAL MASS"
20–80 Hz
oscillators + heavily filtered brown noise
slow envelopes
          │
          ├───────────┐
          │           │
"TEXTURE / FRACTURE"  │
80–800 Hz             │
noise bursts          │
bandpass resonances   │
data-driven transients│
          │           │
          └───── sum ─┴─> saturation/compression
```

The lower layer communicates continuous movement; the upper layer gives you 
cracks, impacts, roughness, and details that make the sonification intelligible.

Since you're already doing spectral processing, there's an especially nice 
extension available to you: rather than using four or five Web Audio filters, 
you could treat the earthquake data as a **time-varying spectral envelope**. 
Your spectral processor could impose a slowly moving envelope on noise, 
essentially making the seismic data describe the shape of the rumble spectrum. 
That would give you substantially richer control than a conventional 
`BiquadFilterNode` graph.

I'd probably prototype the Web Audio version first, though. 
**Brown noise + 3 broad resonances + a 25–40 Hz sub oscillator + slow 
irregular modulation + mild `WaveShaperNode` saturation** is the first 
combination I'd try. It can get surprisingly cinematic while still 
leaving you several independent parameters to map meaningfully to seismic data.
