#!/usr/bin/env swift
import AVFoundation
import AudioToolbox
import Foundation

// Deterministic pseudo-random generator for subtle humanization without non-reproducible builds.
struct SeededRNG {
  private var state: UInt64
  init(seed: UInt64) { self.state = seed == 0 ? 0x9E3779B97F4A7C15 : seed }
  mutating func nextDouble() -> Double {
    state ^= state >> 12
    state ^= state << 25
    state ^= state >> 27
    let value = state &* 0x2545F4914F6CDD1D
    return Double(value >> 11) / Double(1 << 53)
  }
  mutating func range(_ lo: Double, _ hi: Double) -> Double {
    lo + (hi - lo) * nextDouble()
  }
}

enum MidiEventKind {
  case noteOn(channel: UInt8, note: UInt8, velocity: UInt8)
  case noteOff(channel: UInt8, note: UInt8)
  case control(channel: UInt8, cc: UInt8, value: UInt8)
  case program(channel: UInt8, program: UInt8)
  case pitchBend(channel: UInt8, value: UInt16) // 0..16383, center 8192
}

struct ScheduledMidiEvent {
  let timeSec: Double
  let order: Int
  let kind: MidiEventKind
}

final class ScoreBuilder {
  var events: [ScheduledMidiEvent] = []
  private var nextOrder = 0
  private var rng: SeededRNG

  init(seed: UInt64) {
    self.rng = SeededRNG(seed: seed)
  }

  func emit(_ timeSec: Double, _ kind: MidiEventKind) {
    events.append(ScheduledMidiEvent(timeSec: max(0.0, timeSec), order: nextOrder, kind: kind))
    nextOrder += 1
  }

  func setupChannel(_ ch: UInt8, program: UInt8, volume: UInt8, pan: UInt8 = 64, expression: UInt8 = 108) {
    emit(0.0, .program(channel: ch, program: program))
    emit(0.001, .control(channel: ch, cc: 7, value: volume))
    emit(0.002, .control(channel: ch, cc: 10, value: pan))
    emit(0.003, .control(channel: ch, cc: 11, value: expression))
    emit(0.004, .pitchBend(channel: ch, value: 8192))
  }

  func note(
    channel: UInt8,
    pitch: Int,
    startSec: Double,
    durationSec: Double,
    velocity: Int,
    humanizeMs: Double = 9.0
  ) {
    let jitter = humanizeMs > 0 ? rng.range(-humanizeMs, humanizeMs) / 1000.0 : 0.0
    let velJitter = Int(rng.range(-4.0, 4.0))
    let p = UInt8(clamping: pitch)
    let v = UInt8(clamping: max(12, min(124, velocity + velJitter)))
    let t0 = max(0.008, startSec + jitter)
    let t1 = max(t0 + 0.04, t0 + durationSec)
    emit(t0, .noteOn(channel: channel, note: p, velocity: v))
    emit(t1, .noteOff(channel: channel, note: p))
  }

  /// Rolled piano chord with sympathetic low-to-high micro-strum.
  func rolledChord(
    channel: UInt8,
    pitches: [Int],
    startSec: Double,
    durationSec: Double,
    velocity: Int,
    spreadSec: Double = 0.028
  ) {
    let sorted = pitches.sorted()
    for (idx, p) in sorted.enumerated() {
      let v = velocity + (idx == sorted.count - 1 ? 5 : -3)
      note(
        channel: channel,
        pitch: p,
        startSec: startSec + Double(idx) * spreadSec,
        durationSec: max(0.12, durationSec - Double(idx) * spreadSec * 0.5),
        velocity: v,
        humanizeMs: 5.0
      )
    }
  }

  /// Sustain pedal press + clean lift before harmonic change.
  func pedal(channel: UInt8, startSec: Double, endSec: Double) {
    emit(max(0.005, startSec), .control(channel: channel, cc: 64, value: 0))
    emit(max(0.020, startSec + 0.022), .control(channel: channel, cc: 64, value: 120))
    emit(max(startSec + 0.05, endSec - 0.03), .control(channel: channel, cc: 64, value: 0))
  }

  /// Guzheng plucked note with optional left-hand `rou-xian` vibrato on channel 1 (+ soft harp body on ch 2).
  func guzhengNote(
    pitch: Int,
    startSec: Double,
    durationSec: Double,
    velocity: Int,
    vibrato: Bool = false,
    harpLayer: Bool = true
  ) {
    note(channel: 1, pitch: pitch, startSec: startSec, durationSec: durationSec, velocity: velocity, humanizeMs: 7.0)
    if harpLayer {
      note(channel: 2, pitch: pitch, startSec: startSec + 0.004, durationSec: durationSec * 1.15, velocity: max(18, velocity - 24), humanizeMs: 6.0)
    }
    if vibrato && durationSec > 0.45 {
      let steps = Int(min(18.0, (durationSec - 0.18) * 14.0))
      for i in 0..<steps {
        let t = startSec + 0.16 + Double(i) * 0.065
        let env = sin(Double.pi * Double(i) / Double(max(1, steps)))
        let delta = Int(sin(Double(i) * 1.35) * 210.0 * env)
        emit(t, .pitchBend(channel: 1, value: UInt16(clamping: 8192 + delta)))
      }
      emit(startSec + durationSec - 0.02, .pitchBend(channel: 1, value: 8192))
    }
  }

  /// Guzheng pentatonic glissando (`gua-zou`).
  func guzhengGlissando(
    pitches: [Int],
    startSec: Double,
    spanSec: Double,
    startVel: Int,
    endVel: Int
  ) {
    guard !pitches.isEmpty else { return }
    let step = spanSec / Double(max(1, pitches.count))
    for (i, p) in pitches.enumerated() {
      let frac = Double(i) / Double(max(1, pitches.count - 1))
      let vel = Int(Double(startVel) + Double(endVel - startVel) * frac)
      guzhengNote(pitch: p, startSec: startSec + Double(i) * step, durationSec: 1.4, velocity: vel, vibrato: false, harpLayer: true)
    }
  }

  /// Breathing string/flute expression swell (`CC 11`).
  func expressionArc(channel: UInt8, startSec: Double, durationSec: Double, low: Int, peak: Int, peakPos: Double = 0.45) {
    let steps = max(8, Int(durationSec * 10.0))
    for i in 0...steps {
      let u = Double(i) / Double(steps)
      let tri = u < peakPos ? (u / peakPos) : ((1.0 - u) / max(0.05, 1.0 - peakPos))
      let smooth = 0.5 - 0.5 * cos(Double.pi * max(0.0, min(1.0, tri)))
      let val = UInt8(clamping: low + Int(Double(peak - low) * smooth))
      emit(startSec + u * durationSec, .control(channel: channel, cc: 11, value: val))
    }
  }
}

/// Maps beat positions to wall-clock seconds through a piecewise-linear tempo curve `(beat, bpm)`.
struct TempoMap {
  let points: [(beat: Double, bpm: Double)]

  func bpm(at beat: Double) -> Double {
    guard let first = points.first else { return 80.0 }
    if beat <= first.beat { return first.bpm }
    for i in 0..<(points.count - 1) {
      let a = points[i]
      let b = points[i + 1]
      if beat <= b.beat {
        let span = max(0.0001, b.beat - a.beat)
        let u = (beat - a.beat) / span
        return a.bpm + (b.bpm - a.bpm) * u
      }
    }
    return points.last!.bpm
  }

  func sec(at targetBeat: Double) -> Double {
    if targetBeat <= 0 { return 0.0 }
    let step = 0.05
    var b = 0.0
    var acc = 0.0
    while b < targetBeat {
      let nextB = min(targetBeat, b + step)
      let midBpm = bpm(at: 0.5 * (b + nextB))
      acc += (nextB - b) * (60.0 / midBpm)
      b = nextB
    }
    return acc
  }
}

func renderScoreToWav(
  builder: ScoreBuilder,
  totalDurationSec: Double,
  reverbWet: Float,
  highShelfCutDb: Float,
  outputWavPath: String
) throws {
  let sampleRate: Double = 44100.0
  let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
  let engine = AVAudioEngine()

  let synthDesc = AudioComponentDescription(
    componentType: kAudioUnitType_MusicDevice,
    componentSubType: kAudioUnitSubType_MIDISynth,
    componentManufacturer: kAudioUnitManufacturer_Apple,
    componentFlags: 0,
    componentFlagsMask: 0
  )
  let synth = AVAudioUnitMIDIInstrument(audioComponentDescription: synthDesc)

  let eq = AVAudioUnitEQ(numberOfBands: 2)
  // Warm low-mid body
  eq.bands[0].filterType = .parametric
  eq.bands[0].frequency = 210
  eq.bands[0].bandwidth = 1.2
  eq.bands[0].gain = 2.0
  eq.bands[0].bypass = false
  // Felt-piano silk roll-off to tame harsh upper GM transients
  eq.bands[1].filterType = .highShelf
  eq.bands[1].frequency = 5600
  eq.bands[1].gain = highShelfCutDb
  eq.bands[1].bypass = false

  let reverb = AVAudioUnitReverb()
  reverb.loadFactoryPreset(.largeHall2)
  reverb.wetDryMix = reverbWet

  engine.attach(synth)
  engine.attach(eq)
  engine.attach(reverb)

  engine.connect(synth, to: eq, format: format)
  engine.connect(eq, to: reverb, format: format)
  engine.connect(reverb, to: engine.mainMixerNode, format: format)

  let maxFrames: AVAudioFrameCount = 1024
  try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: maxFrames)
  try engine.start()

  var cfBankURL: CFURL = NSURL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls") as CFURL
  _ = withUnsafePointer(to: &cfBankURL) { ptr in
    AudioUnitSetProperty(
      synth.audioUnit,
      AudioUnitPropertyID(kMusicDeviceProperty_SoundBankURL),
      AudioUnitScope(kAudioUnitScope_Global),
      0,
      ptr,
      UInt32(MemoryLayout<CFURL>.size)
    )
  }

  let sorted = builder.events.sorted {
    if $0.timeSec != $1.timeSec { return $0.timeSec < $1.timeSec }
    return $0.order < $1.order
  }

  let outUrl = URL(fileURLWithPath: outputWavPath)
  let outSettings: [String: Any] = [
    AVFormatIDKey: kAudioFormatLinearPCM,
    AVSampleRateKey: sampleRate,
    AVNumberOfChannelsKey: 2,
    AVLinearPCMBitDepthKey: 16,
    AVLinearPCMIsFloatKey: false,
    AVLinearPCMIsBigEndianKey: false,
    AVLinearPCMIsNonInterleaved: false,
  ]
  let outFile = try AVAudioFile(forWriting: outUrl, settings: outSettings)
  let pcmBuffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: maxFrames)!

  let totalFrames = AVAudioFramePosition(totalDurationSec * sampleRate)
  var eventIdx = 0

  while engine.manualRenderingSampleTime < totalFrames {
    let blockStartSample = engine.manualRenderingSampleTime
    let remaining = totalFrames - blockStartSample
    let framesToRender = AVAudioFrameCount(min(AVAudioFramePosition(maxFrames), remaining))
    let blockEndSec = Double(blockStartSample + AVAudioFramePosition(framesToRender)) / sampleRate

    while eventIdx < sorted.count && sorted[eventIdx].timeSec <= blockEndSec {
      let ev = sorted[eventIdx]
      switch ev.kind {
      case let .noteOn(ch, note, vel):
        synth.startNote(note, withVelocity: vel, onChannel: ch)
      case let .noteOff(ch, note):
        synth.stopNote(note, onChannel: ch)
      case let .control(ch, cc, val):
        synth.sendController(cc, withValue: val, onChannel: ch)
      case let .program(ch, prog):
        synth.sendProgramChange(prog, onChannel: ch)
      case let .pitchBend(ch, val):
        synth.sendPitchBend(val, onChannel: ch)
      }
      eventIdx += 1
    }

    let status = try engine.renderOffline(framesToRender, to: pcmBuffer)
    if status == .success {
      try outFile.write(from: pcmBuffer)
    } else if status == .error {
      throw NSError(domain: "ComposeGameBgm", code: 2, userInfo: [NSLocalizedDescriptionKey: "Offline render failed"])
    }
  }

  engine.stop()
}

// ─── Movement I: Night Vigil (月黑风高 · 暗夜潜行, A-Yu Minor Pentatonic + Dorian tension) ───
func buildNightVigil() -> (ScoreBuilder, Double) {
  let s = ScoreBuilder(seed: 101)
  // Ch 0: Piano, Ch 1: Guzheng, Ch 2: Soft Harp body, Ch 3: Tremolo Strings, Ch 4: Shakuhachi/Xiao, Ch 5: Low Taiko
  s.setupChannel(0, program: 0, volume: 96, pan: 60, expression: 102)
  s.setupChannel(1, program: 107, volume: 92, pan: 74, expression: 105)
  s.setupChannel(2, program: 46, volume: 68, pan: 70, expression: 96)
  s.setupChannel(3, program: 44, volume: 70, pan: 52, expression: 60)
  s.setupChannel(4, program: 77, volume: 68, pan: 46, expression: 55)
  s.setupChannel(5, program: 116, volume: 72, pan: 64, expression: 88)

  // Subtle nocturnal breathing tempo (62–68 BPM across 16 bars = 64 beats + 4-beat reverb tail)
  let tm = TempoMap(points: [
    (0, 64), (16, 67), (32, 63), (48, 68), (64, 64), (72, 64),
  ])

  // 16 bars of dark moonlit Jianghu progression: Am9 -> Fmaj7(#11) -> Dm9 -> E7sus4/Em7 (x2 cycles with evolving Xiao & Guzheng)
  let barChords: [(bass: Int, pad: [Int], arp: [Int])] = [
    // Cycle 1 (bars 0..7): Hushed nocturnal mist, sparse piano droplets & distant guzheng harmonics
    (45, [57, 64, 67], [57, 64, 69, 71, 72]), // Am9 (A2, A3-E4-G4)
    (45, [57, 62, 64], [57, 62, 67, 72, 76]), // Am(add4)
    (41, [53, 60, 64], [53, 60, 67, 69, 71]), // Fmaj9(#11: B4 eerie moonlight)
    (41, [53, 59, 64], [53, 60, 64, 69, 72]),
    (38, [50, 57, 60], [50, 57, 64, 65, 69]), // Dm9
    (40, [52, 59, 62], [52, 57, 62, 64, 69]), // E7sus4 -> Em7 suspense
    (45, [57, 60, 64], [57, 62, 64, 69, 72]), // Am
    (40, [52, 55, 59], [52, 59, 64, 67, 71]), // Em

    // Cycle 2 (bars 8..15): Deeper tension — Xiao mournful call + Guzheng pitch-bent sighs
    (45, [57, 64, 69], [57, 64, 69, 72, 76]), // Am
    (43, [55, 62, 67], [55, 62, 67, 69, 74]), // G6
    (41, [53, 60, 64], [53, 60, 64, 69, 71]), // Fmaj7(#11)
    (40, [52, 59, 64], [52, 59, 64, 68, 71]), // E(add b9/sus) subtle shadow
    (38, [50, 57, 62], [50, 57, 62, 65, 69]), // Dm
    (40, [52, 57, 64], [52, 59, 64, 67, 71]), // Em7
    (45, [57, 62, 64], [57, 64, 69, 71, 72]), // Am9
    (45, [57, 64, 69], [57, 62, 64, 69, 69]), // Am resolve seamlessly into loop
  ]

  for (bar, ch) in barChords.enumerated() {
    let b0 = Double(bar * 4)
    let t0 = tm.sec(at: b0)
    let tBarEnd = tm.sec(at: b0 + 4.0)
    s.pedal(channel: 0, startSec: t0, endSec: tBarEnd)

    // Deep resonant Piano bass octave on beat 1
    s.note(channel: 0, pitch: ch.bass, startSec: t0, durationSec: tBarEnd - t0, velocity: bar % 2 == 0 ? 58 : 48)
    s.note(channel: 0, pitch: ch.bass + 12, startSec: t0 + 0.02, durationSec: (tBarEnd - t0) * 0.85, velocity: 46)

    // Sparse crystalline Piano accompaniment notes
    let pattern: [(Double, Int, Int)] = [
      (1.0, ch.arp[1], 44),
      (2.0, ch.arp[2], 50),
      (2.75, ch.arp[3], 42),
      (3.5, ch.arp[4], 46),
    ]
    for (offset, p, vel) in pattern {
      let ts = tm.sec(at: b0 + offset)
      s.note(channel: 0, pitch: p, startSec: ts, durationSec: 1.35, velocity: vel)
    }

    // Tremolo strings dark mist pad (every 2 bars)
    if bar % 2 == 0 {
      let tNext2 = tm.sec(at: b0 + 8.0)
      s.expressionArc(channel: 3, startSec: t0, durationSec: tNext2 - t0, low: 28, peak: bar >= 8 ? 72 : 56, peakPos: 0.55)
      for p in ch.pad {
        s.note(channel: 3, pitch: p, startSec: t0 + 0.05, durationSec: tNext2 - t0 - 0.12, velocity: 54, humanizeMs: 14)
      }
      // Heartbeat low Taiko pulse on beat 1 and beat 4.5 of 2-bar cell
      s.note(channel: 5, pitch: 33, startSec: t0, durationSec: 0.9, velocity: 46, humanizeMs: 4)
      s.note(channel: 5, pitch: 33, startSec: tm.sec(at: b0 + 3.5), durationSec: 0.7, velocity: 34, humanizeMs: 5)
    }
  }

  // Opening nocturnal Guzheng downward whisper & sparse suspenseful motifs
  s.guzhengGlissando(pitches: [81, 79, 76, 74, 72, 69], startSec: tm.sec(at: 0.25), spanSec: 0.65, startVel: 42, endVel: 62)

  // Haunting nocturnal Guzheng + High Piano call-and-response melody (A-Yu pentatonic: A4=69, C5=72, D5=74, E5=76, G5=79, A5=81)
  let nightMelody: [(beat: Double, dur: Double, pitch: Int, vel: Int, vib: Bool)] = [
    // Phrase 1 (bar 1..3): "Shadow behind paper windows"
    (4.0, 2.0, 76, 66, true), (6.0, 1.0, 74, 58, false), (7.0, 1.5, 72, 62, false),
    (9.0, 2.5, 69, 64, true), (12.0, 1.5, 71, 56, false), (13.5, 2.5, 72, 60, true),
    // Phrase 2 (bar 5..7): "Footsteps on moonlit frost"
    (20.0, 1.5, 74, 64, false), (21.5, 1.5, 76, 68, false), (23.0, 2.5, 79, 72, true),
    (26.0, 1.0, 76, 60, false), (27.0, 1.0, 74, 56, false), (28.0, 3.5, 69, 62, true),
    // Phrase 3 (bar 9..11): Higher suspenseful arch
    (36.0, 1.5, 76, 70, false), (37.5, 1.5, 79, 74, false), (39.0, 2.5, 81, 78, true),
    (42.0, 1.5, 79, 66, false), (43.5, 1.5, 76, 64, false), (45.0, 2.5, 74, 68, true),
    // Phrase 4 (bar 13..15): Resolve into misty A minor silence
    (52.0, 1.5, 72, 64, false), (53.5, 1.5, 74, 66, false), (55.0, 2.0, 76, 68, true),
    (57.5, 1.5, 72, 58, false), (59.0, 4.0, 69, 60, true),
  ]
  for m in nightMelody {
    let ts = tm.sec(at: m.beat)
    let td = tm.sec(at: m.beat + m.dur) - ts
    s.guzhengNote(pitch: m.pitch, startSec: ts, durationSec: td, velocity: m.vel, vibrato: m.vib)
    // Delicate high Piano octave shadow on accent notes
    if m.vib {
      s.note(channel: 0, pitch: m.pitch + 12, startSec: ts + 0.03, durationSec: td * 0.9, velocity: max(30, m.vel - 24))
    }
  }

  // Breathy Bamboo Xiao nocturnal phrases in Cycle 2
  let xiaoNotes: [(beat: Double, dur: Double, pitch: Int, peak: Int)] = [
    (32.5, 3.2, 69, 74),
    (40.5, 3.2, 72, 78),
    (48.5, 3.2, 74, 76),
    (56.5, 4.5, 69, 70),
  ]
  for x in xiaoNotes {
    let ts = tm.sec(at: x.beat)
    let td = tm.sec(at: x.beat + x.dur) - ts
    s.expressionArc(channel: 4, startSec: ts, durationSec: td, low: 22, peak: x.peak, peakPos: 0.4)
    s.note(channel: 4, pitch: x.pitch, startSec: ts, durationSec: td, velocity: 68, humanizeMs: 12)
  }

  let endSec = tm.sec(at: 68.0) // 64 beats + 4 beats natural reverb tail for crossfade loop
  return (s, endSec)
}

// ─── Movement II: Dawn & Teahouse Debate (破晓迷雾 · 客栈论剑, C Major / A Minor Pentatonic) ───
func buildDayDebate() -> (ScoreBuilder, Double) {
  let s = ScoreBuilder(seed: 202)
  // Warm, lyrical Concert Grand Piano + Guzheng + Legato Strings + Solo Cello (same sonic world as Red Dust Inn!)
  s.setupChannel(0, program: 0, volume: 100, pan: 58, expression: 106)   // Grand Piano
  s.setupChannel(1, program: 107, volume: 88, pan: 74, expression: 102)  // Guzheng
  s.setupChannel(2, program: 46, volume: 66, pan: 70, expression: 94)    // Harp body
  s.setupChannel(3, program: 49, volume: 68, pan: 52, expression: 66)    // Slow Strings
  s.setupChannel(4, program: 42, volume: 74, pan: 46, expression: 72)    // Warm Solo Cello

  // Graceful, poised Jianghu ballad flow (78–83 BPM gentle rubato across 16 bars = 64 beats)
  let tm = TempoMap(points: [
    (0, 79), (16, 82), (32, 78), (48, 83), (64, 79), (72, 79),
  ])

  // Classic Jay-Chou / Huang-Yuxun style Chinese ballad progression:
  // Fmaj7 -> G6 -> Em7 -> Am9 -> Dm7 -> G7sus4 -> Cmaj9 -> Cmaj7/E (x2 cycles)
  let dayChords: [(bass: Int, arp: [Int], pad: [Int], cello: Int)] = [
    (41, [53, 60, 64, 69, 72], [60, 64, 69], 53), // Fmaj7
    (43, [55, 62, 67, 69, 74], [59, 62, 67], 55), // G6
    (40, [52, 59, 64, 67, 71], [59, 64, 67], 52), // Em7
    (45, [57, 64, 69, 71, 72], [60, 64, 69], 57), // Am9
    (38, [50, 57, 60, 65, 69], [57, 60, 65], 50), // Dm7
    (43, [55, 60, 62, 67, 71], [59, 62, 67], 55), // G7sus4 -> G
    (36, [48, 55, 62, 64, 67], [60, 64, 67], 48), // Cmaj9
    (40, [52, 55, 60, 64, 67], [59, 64, 67], 52), // C/E -> lead back to Fmaj7

    (41, [53, 60, 64, 69, 72], [60, 64, 69], 53), // Fmaj7
    (43, [55, 62, 67, 71, 74], [59, 62, 67], 55), // G
    (40, [52, 59, 64, 67, 74], [59, 64, 67], 52), // Em7
    (45, [57, 64, 69, 72, 76], [60, 64, 69], 57), // Am
    (38, [50, 57, 62, 65, 69], [57, 62, 65], 50), // Dm9
    (40, [52, 59, 64, 67, 71], [59, 64, 67], 52), // Em7
    (41, [53, 60, 64, 67, 69], [60, 64, 67], 53), // Fmaj9
    (43, [55, 62, 67, 69, 72], [59, 62, 67], 55), // G6add4 -> resolves smoothly to Fmaj7/Cmaj
  ]

  // Opening sunlit Guzheng C-pentatonic upward glissando
  s.guzhengGlissando(pitches: [60, 62, 64, 67, 69, 72, 74, 76], startSec: tm.sec(at: 0.1), spanSec: 0.55, startVel: 44, endVel: 66)

  for (bar, ch) in dayChords.enumerated() {
    let b0 = Double(bar * 4)
    let t0 = tm.sec(at: b0)
    let tBarEnd = tm.sec(at: b0 + 4.0)
    s.pedal(channel: 0, startSec: t0, endSec: tBarEnd)

    // Flowing 8th-note Concert Grand Piano left-hand arpeggio (classic Chinese ballad piano accompaniment)
    s.note(channel: 0, pitch: ch.bass, startSec: t0, durationSec: tBarEnd - t0, velocity: 62)
    let eighthOffsets: [(Double, Int, Int)] = [
      (0.5, ch.arp[0], 46),
      (1.0, ch.arp[1], 52),
      (1.5, ch.arp[2], 50),
      (2.0, ch.arp[3], 56),
      (2.5, ch.arp[2], 48),
      (3.0, ch.arp[4], 54),
      (3.5, ch.arp[2], 46),
    ]
    for (off, p, vel) in eighthOffsets {
      let ts = tm.sec(at: b0 + off)
      s.note(channel: 0, pitch: p, startSec: ts, durationSec: 0.95, velocity: vel)
    }

    // Warm legato Cello bass line + soft Strings pad in Cycle 2
    let celloDur = tBarEnd - t0 - 0.08
    s.expressionArc(channel: 4, startSec: t0, durationSec: celloDur, low: 34, peak: 72, peakPos: 0.45)
    s.note(channel: 4, pitch: ch.cello, startSec: t0 + 0.03, durationSec: celloDur, velocity: 60, humanizeMs: 10)

    if bar >= 8 && bar % 2 == 0 {
      let tNext2 = tm.sec(at: b0 + 8.0)
      s.expressionArc(channel: 3, startSec: t0, durationSec: tNext2 - t0, low: 30, peak: 66, peakPos: 0.5)
      for p in ch.pad {
        s.note(channel: 3, pitch: p, startSec: t0 + 0.04, durationSec: tNext2 - t0 - 0.1, velocity: 52, humanizeMs: 12)
      }
    }
  }

  // Poised, lyrical Piano right-hand + Guzheng dialogue melody (C pentatonic: C5=72, D5=74, E5=76, G5=79, A5=81, C6=84)
  // Designed to leave uncluttered mid-range space for human reading & AI speech!
  let dayMelody: [(beat: Double, dur: Double, pitch: Int, vel: Int, guzhengEcho: Bool)] = [
    // Bars 0..3: Morning mist parts over terraced roofs
    (1.0, 1.5, 76, 72, false), (2.5, 0.5, 74, 64, false), (3.0, 1.0, 72, 68, false),
    (4.0, 2.0, 74, 72, true),  (6.5, 1.5, 76, 68, false),
    (8.0, 1.5, 79, 74, false), (9.5, 0.5, 76, 66, false), (10.0, 2.0, 74, 70, false),
    (12.0, 3.0, 72, 72, true),
    // Bars 4..7: Calm teahouse deduction & glances across the table
    (17.0, 1.0, 69, 66, false), (18.0, 1.0, 72, 70, false), (19.0, 1.0, 74, 72, false),
    (20.0, 2.0, 76, 76, true),  (22.5, 1.5, 74, 68, false),
    (24.0, 1.5, 72, 72, false), (25.5, 1.5, 74, 70, false), (27.0, 1.0, 76, 74, false),
    (28.0, 3.2, 76, 72, true),
    // Bars 8..11: Soaring Jianghu reflection
    (33.0, 1.5, 79, 78, false), (34.5, 0.5, 81, 74, false), (35.0, 1.0, 84, 80, false),
    (36.0, 2.5, 81, 78, true),  (39.0, 1.0, 79, 72, false),
    (40.0, 1.5, 76, 76, false), (41.5, 0.5, 74, 68, false), (42.0, 2.0, 72, 74, false),
    (44.0, 3.0, 69, 72, true),
    // Bars 12..15: Gentle return
    (49.0, 1.5, 72, 70, false), (50.5, 1.5, 74, 72, false),
    (52.0, 2.0, 76, 74, true),  (54.5, 1.5, 79, 72, false),
    (56.0, 2.0, 76, 70, false), (58.0, 2.0, 74, 68, false),
    (60.0, 3.5, 72, 68, true),
  ]

  for m in dayMelody {
    let ts = tm.sec(at: m.beat)
    let td = tm.sec(at: m.beat + m.dur) - ts
    s.note(channel: 0, pitch: m.pitch, startSec: ts, durationSec: td * 1.08, velocity: m.vel, humanizeMs: 8.0)
    if m.guzhengEcho {
      // Guzheng delicate ornamental response on sustained phrase endings
      let echoStart = tm.sec(at: m.beat + 1.0)
      s.guzhengNote(pitch: m.pitch, startSec: echoStart, durationSec: 1.1, velocity: m.vel - 8, vibrato: true)
      s.guzhengNote(pitch: m.pitch - 3, startSec: echoStart + 0.34, durationSec: 0.9, velocity: m.vel - 14, vibrato: false)
    }
  }

  let endSec = tm.sec(at: 68.0)
  return (s, endSec)
}

// ─── Movement III: Blade of Exile (公堂对决 · 放逐立判 — Dynamic Fast-Slow Rubato & Rhythmic Surge!) ───
func buildExileVote() -> (ScoreBuilder, Double) {
  let s = ScoreBuilder(seed: 303)
  // Dramatic Wuxia trial & standoff: Grand Piano ostinato + Guzheng rapid plucks + Pizzicato/Tremolo Strings + Taiko/Woodblock!
  s.setupChannel(0, program: 0, volume: 102, pan: 58, expression: 108)   // Grand Piano
  s.setupChannel(1, program: 107, volume: 96, pan: 76, expression: 108)  // Guzheng
  s.setupChannel(2, program: 46, volume: 68, pan: 72, expression: 96)    // Harp layer
  s.setupChannel(3, program: 45, volume: 82, pan: 48, expression: 98)    // Pizzicato Strings (taut rhythmic pulse!)
  s.setupChannel(4, program: 44, volume: 74, pan: 52, expression: 68)    // Tremolo Strings tension swells
  s.setupChannel(5, program: 116, volume: 82, pan: 64, expression: 96)   // Taiko Drum
  s.setupChannel(6, program: 115, volume: 58, pan: 68, expression: 84)   // Crisp Woodblock clack

  // SIGNATURE FEATURE ("在白天放逐的时候时快时慢，节奏富有韵律变化"):
  // Wave 1 (beats 0..16): Taut standoff acceleration 76 -> 98 BPM
  // Wave 2 (beats 16..32): Urgent blade-drawn surge 98 -> 118 BPM -> sudden breath ritenuto at beat 30..32 (72 BPM!)
  // Wave 3 (beats 32..48): Deliberate heavy reckoning 76 -> 108 BPM
  // Wave 4 (beats 48..64): Climax 120 BPM -> dramatic suspension & poised deceleration back to 76 BPM for seamless loop!
  let tm = TempoMap(points: [
    (0, 76),
    (8, 86),
    (16, 102),
    (26, 118),
    (30, 72),   // Sudden dramatic breath / standoff pause!
    (33, 78),
    (40, 96),
    (48, 116),
    (56, 120),
    (61, 80),   // Poised ritardando back into beat 0
    (68, 76),
  ])

  // D Dorian / A-Yu dramatic Wuxia duel progression: Dm -> Bbmaj7 -> Gm7 -> A7sus4/A (classic heroic standoff!)
  let duelChords: [(bass: Int, ostinato: [Int], trem: [Int])] = [
    // Wave 1 (bars 0..3): Taut measured standoff
    (38, [50, 57, 62, 65], [62, 65, 69]), // Dm
    (38, [50, 57, 60, 62], [60, 65, 69]), // Dm7
    (34, [46, 53, 58, 62], [58, 62, 65]), // Bbmaj7
    (33, [45, 52, 57, 62], [57, 62, 64]), // Asus4 -> A
    // Wave 2 (bars 4..7): Accelerando surge -> sudden breath at bar 7!
    (38, [50, 57, 62, 65], [62, 65, 69]), // Dm
    (36, [48, 55, 60, 64], [60, 64, 67]), // C
    (34, [46, 53, 58, 62], [58, 62, 65]), // Bb
    (33, [45, 52, 57, 61], [57, 61, 64]), // A7 dramatic hold!
    // Wave 3 (bars 8..11): Regathering momentum
    (31, [43, 50, 55, 58], [58, 62, 67]), // Gm7
    (36, [48, 55, 60, 64], [60, 64, 67]), // C
    (37, [41, 53, 57, 60], [60, 65, 69]), // Fmaj7
    (38, [50, 57, 62, 65], [62, 65, 69]), // Dm
    // Wave 4 (bars 12..15): Climax & ritardando resolution
    (31, [43, 50, 55, 58], [58, 62, 67]), // Gm
    (33, [45, 52, 57, 62], [57, 62, 64]), // Asus4
    (34, [46, 53, 58, 62], [58, 62, 65]), // Bbmaj7
    (33, [45, 52, 57, 61], [57, 61, 64]), // A -> resolves to Dm bar 0!
  ]

  for (bar, ch) in duelChords.enumerated() {
    let b0 = Double(bar * 4)
    let t0 = tm.sec(at: b0)
    let tBarEnd = tm.sec(at: b0 + 4.0)
    let isBreathBar = (bar == 7 || bar == 15)

    s.pedal(channel: 0, startSec: t0, endSec: tBarEnd)

    // Driving Piano low octave strike on beat 1
    s.note(channel: 0, pitch: ch.bass, startSec: t0, durationSec: (tBarEnd - t0) * 0.9, velocity: isBreathBar ? 78 : 72)
    s.note(channel: 0, pitch: ch.bass + 12, startSec: t0 + 0.012, durationSec: (tBarEnd - t0) * 0.85, velocity: isBreathBar ? 74 : 66)

    if isBreathBar {
      // Sudden dramatic suspension (`慢` — breath-holding silence & rolled Guzheng chord!)
      s.rolledChord(channel: 0, pitches: ch.ostinato, startSec: t0 + 0.04, durationSec: tBarEnd - t0, velocity: 68, spreadSec: 0.045)
      s.guzhengGlissando(
        pitches: [62, 64, 65, 69, 74, 76, 81],
        startSec: tm.sec(at: b0 + 1.5),
        spanSec: 0.75,
        startVel: 48,
        endVel: 74
      )
      s.note(channel: 5, pitch: 38, startSec: t0, durationSec: 1.2, velocity: 72, humanizeMs: 4)
    } else {
      // Syncopated 3+3+2 rhythmic ostinato (`1 . 2+ . 4`) on Piano + Pizzicato Strings!
      let syncopatedBeats: [(Double, Int, Int)] = [
        (0.0, ch.ostinato[0], 66),
        (0.5, ch.ostinato[1], 50),
        (1.0, ch.ostinato[2], 56),
        (1.5, ch.ostinato[3], 68), // Syncopated accent!
        (2.0, ch.ostinato[1], 48),
        (2.5, ch.ostinato[2], 54),
        (3.0, ch.ostinato[3], 66), // Beat 4 accent!
        (3.5, ch.ostinato[2], 52),
      ]
      for (off, p, vel) in syncopatedBeats {
        let ts = tm.sec(at: b0 + off)
        s.note(channel: 0, pitch: p, startSec: ts, durationSec: 0.42, velocity: vel, humanizeMs: 5.0)
        // Pizzicato string pulse on key syncopations (0.0, 1.5, 3.0)
        if off == 0.0 || off == 1.5 || off == 3.0 {
          s.note(channel: 3, pitch: p + 12, startSec: ts, durationSec: 0.24, velocity: vel - 4, humanizeMs: 5.0)
        }
      }

      // Taiko & Woodblock rhythmic punctuation during faster surge bars
      s.note(channel: 5, pitch: 38, startSec: t0, durationSec: 0.65, velocity: bar >= 4 && bar <= 6 || bar >= 12 ? 68 : 54, humanizeMs: 4)
      s.note(channel: 5, pitch: 41, startSec: tm.sec(at: b0 + 1.5), durationSec: 0.45, velocity: 52, humanizeMs: 4)
      if bar >= 4 && bar <= 6 || (bar >= 11 && bar <= 14) {
        s.note(channel: 6, pitch: 76, startSec: tm.sec(at: b0 + 3.0), durationSec: 0.15, velocity: 50, humanizeMs: 3)
      }
    }

    // Tremolo strings suspense swell every 2 bars
    if bar % 2 == 0 {
      let tNext2 = tm.sec(at: b0 + 8.0)
      s.expressionArc(channel: 4, startSec: t0, durationSec: tNext2 - t0, low: 32, peak: 78, peakPos: 0.65)
      for p in ch.trem {
        s.note(channel: 4, pitch: p, startSec: t0 + 0.03, durationSec: tNext2 - t0 - 0.1, velocity: 58, humanizeMs: 10)
      }
    }
  }

  // Incisive Guzheng + Upper Piano Wuxia Duel Melody (D minor pentatonic: D5=74, F5=77, G5=79, A5=81, C6=84, D6=86)
  let voteMelody: [(beat: Double, dur: Double, pitch: Int, vel: Int, vib: Bool)] = [
    // Wave 1: Pointed questioning
    (0.0, 1.5, 74, 76, false), (1.5, 1.5, 77, 78, false), (3.0, 1.0, 81, 82, false),
    (4.0, 2.5, 79, 78, true),  (7.0, 1.0, 77, 72, false),
    (8.0, 1.5, 74, 76, false), (9.5, 1.5, 72, 74, false), (11.0, 1.0, 74, 78, false),
    (12.0, 3.0, 69, 76, true),
    // Wave 2: Rapid blade-cross surge (`快`!)
    (16.0, 0.75, 74, 80, false), (16.75, 0.75, 77, 82, false), (17.5, 1.5, 81, 86, false), (19.0, 1.0, 79, 80, false),
    (20.0, 0.75, 81, 84, false), (20.75, 0.75, 84, 86, false), (21.5, 1.5, 86, 90, true),  (23.0, 1.0, 84, 82, false),
    (24.0, 1.0, 81, 86, false),  (25.0, 1.0, 79, 82, false),   (26.0, 1.0, 77, 80, false),  (27.0, 1.0, 76, 82, false),
    (28.0, 3.5, 81, 86, true), // Holds dramatically across the sudden breath bar!
    // Wave 3: Deliberate counter-argument
    (32.0, 1.5, 79, 78, false), (33.5, 1.5, 77, 76, false), (35.0, 1.0, 74, 78, false),
    (36.0, 2.0, 76, 80, true),  (38.5, 1.5, 79, 78, false),
    (40.0, 1.5, 81, 82, false), (41.5, 1.5, 77, 78, false), (43.0, 1.0, 76, 80, false),
    (44.0, 3.0, 74, 82, true),
    // Wave 4: Final exile verdict climax -> poised pullback
    (48.0, 1.0, 79, 84, false), (49.0, 1.0, 81, 86, false), (50.0, 1.0, 84, 88, false), (51.0, 1.0, 86, 90, false),
    (52.0, 2.5, 81, 88, true),  (55.0, 1.0, 79, 82, false),
    (56.0, 1.5, 77, 84, false), (57.5, 1.5, 76, 80, false), (59.0, 1.0, 74, 78, false),
    (60.0, 3.5, 76, 78, true),
  ]

  for m in voteMelody {
    let ts = tm.sec(at: m.beat)
    let td = tm.sec(at: m.beat + m.dur) - ts
    s.guzhengNote(pitch: m.pitch, startSec: ts, durationSec: td, velocity: m.vel, vibrato: m.vib)
    s.note(channel: 0, pitch: m.pitch, startSec: ts + 0.008, durationSec: td * 0.92, velocity: max(40, m.vel - 10), humanizeMs: 6.0)
  }

  let endSec = tm.sec(at: 68.0)
  return (s, endSec)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  fputs("Usage: compose-game-bgm.swift <out-dir>\n", stderr)
  exit(1)
}
let outDir = args[1]
try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let movements: [(name: String, build: () -> (ScoreBuilder, Double), wet: Float, shelfCut: Float)] = [
  ("game-night-raw.wav", buildNightVigil, 42.0, -4.5),
  ("game-day-raw.wav", buildDayDebate, 34.0, -3.5),
  ("game-vote-raw.wav", buildExileVote, 32.0, -3.0),
]

for m in movements {
  let (score, dur) = m.build()
  let path = (outDir as NSString).appendingPathComponent(m.name)
  try renderScoreToWav(builder: score, totalDurationSec: dur, reverbWet: m.wet, highShelfCutDb: m.shelfCut, outputWavPath: path)
  print("[synth] wrote \(path) (\(String(format: "%.1f", dur))s)")
}
