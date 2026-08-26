import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createWebHaptics,
  getRegistry,
  type HapticEngine,
  type Vibration,
} from 'web-haptics';
import {
  MAP_CELLS,
  MAP_COLUMNS,
  MAP_ROWS,
  MAX_EXPLORER_PULSES,
  RAW_PULSE_STATES,
  PWM_PULSE_STATES,
  addressPattern,
  analyzePattern,
  cumulativePatternSpace,
  exactPatternSignature,
  formatBigInt,
  formatScientific,
  mutatePattern,
  pwmPatternSpace,
  rawPatternSpace,
  tactileRandomPattern,
  uniformRandomPattern,
  type GeneratorSource,
  type PatternAnalysis,
} from './stateSpace';
import {
  clearSpecimens,
  indexedDbAvailable,
  listSpecimens,
  setFavorite,
  upsertSpecimen,
  type StoredSpecimen,
} from './db';
import './styles.css';

const EXPERIMENTS: Array<{ name: string; note: string; pattern: Vibration[] }> = [
  {
    name: 'Heartbeat',
    note: 'paired impact',
    pattern: [
      { duration: 40, intensity: 0.85 },
      { delay: 80, duration: 60, intensity: 1 },
    ],
  },
  {
    name: 'Raindrop',
    note: 'soft decay',
    pattern: [
      { duration: 20, intensity: 0.8 },
      { delay: 40, duration: 20, intensity: 0.45 },
      { delay: 80, duration: 10, intensity: 0.2 },
    ],
  },
  {
    name: 'Zipper',
    note: 'dense rising train',
    pattern: [
      { duration: 20, intensity: 0.25 },
      { delay: 20, duration: 20, intensity: 0.4 },
      { delay: 20, duration: 20, intensity: 0.55 },
      { delay: 20, duration: 20, intensity: 0.7 },
      { delay: 20, duration: 20, intensity: 0.85 },
      { delay: 20, duration: 20, intensity: 1 },
    ],
  },
  {
    name: 'Sonar',
    note: 'wide temporal spacing',
    pattern: [
      { duration: 50, intensity: 0.9 },
      { delay: 240, duration: 30, intensity: 0.55 },
      { delay: 420, duration: 20, intensity: 0.25 },
    ],
  },
  {
    name: 'Typewriter',
    note: 'irregular mechanical',
    pattern: [
      { duration: 10, intensity: 0.7 },
      { delay: 30, duration: 10, intensity: 0.55 },
      { delay: 20, duration: 10, intensity: 0.8 },
      { delay: 40, duration: 10, intensity: 0.5 },
      { delay: 20, duration: 20, intensity: 0.9 },
    ],
  },
  {
    name: 'Comet',
    note: 'long tail',
    pattern: [
      { duration: 80, intensity: 1 },
      { delay: 30, duration: 70, intensity: 0.75 },
      { delay: 40, duration: 50, intensity: 0.5 },
      { delay: 60, duration: 30, intensity: 0.25 },
    ],
  },
  {
    name: 'Glass Tick',
    note: 'minimal crisp point',
    pattern: [{ duration: 10, intensity: 1 }],
  },
  {
    name: 'Quake',
    note: 'slow heavy oscillation',
    pattern: [
      { duration: 180, intensity: 0.85 },
      { delay: 70, duration: 240, intensity: 1 },
      { delay: 90, duration: 160, intensity: 0.65 },
    ],
  },
];

function HapticAction({
  children,
  onActivate,
  className = '',
  title,
}: {
  children: ReactNode;
  onActivate: (event: MouseEvent<HTMLLabelElement>) => void;
  className?: string;
  title?: string;
}) {
  return (
    <label
      className={`hapticAction ${className}`}
      title={title}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).tagName === 'INPUT') return;
        onActivate(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
    >
      <input
        className="nativeSwitch"
        type="checkbox"
        tabIndex={-1}
        aria-hidden="true"
        ref={(element) => element?.setAttribute('switch', '')}
        onClick={(event) => event.stopPropagation()}
      />
      <span className="hapticActionInner">{children}</span>
    </label>
  );
}

function MiniPattern({ pattern }: { pattern: ReadonlyArray<Vibration> }) {
  const total = Math.max(
    1,
    pattern.reduce((sum, vibration) => sum + vibration.duration + (vibration.delay ?? 0), 0),
  );
  return (
    <div className="miniPattern" aria-hidden="true">
      {pattern.map((vibration, index) => (
        <div
          className="miniPulseWrap"
          key={`${index}-${vibration.duration}-${vibration.delay}-${vibration.intensity}`}
          style={{ flex: vibration.duration + (vibration.delay ?? 0) }}
        >
          {(vibration.delay ?? 0) > 0 && (
            <span
              className="miniGap"
              style={{ width: `${((vibration.delay ?? 0) / (vibration.duration + (vibration.delay ?? 0))) * 100}%` }}
            />
          )}
          <span
            className="miniPulse"
            style={{
              width: `${(vibration.duration / (vibration.duration + (vibration.delay ?? 0))) * 100}%`,
              opacity: Math.max(0.12, vibration.intensity ?? 0.5),
              minWidth: `${Math.max(2, (vibration.duration / total) * 100)}%`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function useRefreshRateEstimate() {
  const [hz, setHz] = useState<number | null>(null);

  useEffect(() => {
    let frame = 0;
    let previous = 0;
    const deltas: number[] = [];
    let raf = 0;

    const tick = (now: number) => {
      if (previous) deltas.push(now - previous);
      previous = now;
      frame += 1;
      if (frame < 42) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const sorted = deltas.filter((value) => value > 2 && value < 50).sort((a, b) => a - b);
      if (sorted.length) {
        const median = sorted[Math.floor(sorted.length / 2)]!;
        setHz(Math.round(1000 / median));
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return hz;
}

function specimenLabel(pattern: ReadonlyArray<Vibration>, source: GeneratorSource): string {
  const analysis = analyzePattern(pattern);
  const energy = analysis.energy;
  const complexity = analysis.complexity;
  const first =
    energy > 0.72 ? 'Charged' : energy > 0.46 ? 'Bright' : energy > 0.22 ? 'Soft' : 'Ghost';
  const second =
    complexity > 0.72 ? 'Static' : complexity > 0.46 ? 'Circuit' : complexity > 0.22 ? 'Pulse' : 'Point';
  const suffix = source === 'uniform' ? ' Ω' : source === 'mutation' ? ' μ' : '';
  return `${first} ${second}${suffix}`;
}

function makeSpecimen(
  pattern: ReadonlyArray<Vibration>,
  source: GeneratorSource,
  label?: string,
): Omit<StoredSpecimen, 'firstSeenAt' | 'lastPlayedAt' | 'plays' | 'favorite'> {
  const normalized = pattern.map((vibration) => ({ ...vibration }));
  const raw = addressPattern(normalized, 'raw');
  const pwm = addressPattern(normalized, 'pwm');
  return {
    id: exactPatternSignature(normalized),
    label: label ?? specimenLabel(normalized, source),
    pattern: normalized,
    source,
    analysis: analyzePattern(normalized),
    rawAddress: raw.ordinal.toString(),
    pwmAddress: pwm.ordinal.toString(),
    rawSpace: raw.space.toString(),
    pwmSpace: pwm.space.toString(),
  };
}

function App() {
  const engineRef = useRef<HapticEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createWebHaptics({ reducedMotion: 'ignore' });
  }
  const engine = engineRef.current;
  const refreshHz = useRefreshRateEstimate();

  const [history, setHistory] = useState<StoredSpecimen[]>([]);
  const [current, setCurrent] = useState<StoredSpecimen | null>(null);
  const [pulseCount, setPulseCount] = useState(2);
  const [uniformMode, setUniformMode] = useState<'raw' | 'pwm'>('raw');
  const [storageState, setStorageState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [showFavorites, setShowFavorites] = useState(false);

  const presets = useMemo(() => Object.entries(getRegistry().getAll()), [engine]);

  const refreshHistory = async () => {
    if (!indexedDbAvailable()) {
      setStorageState('unavailable');
      return;
    }
    try {
      const items = await listSpecimens();
      setHistory(items);
      if (!current && items[0]) setCurrent(items[0]);
      setStorageState('ready');
    } catch {
      setStorageState('unavailable');
    }
  };

  useEffect(() => {
    void refreshHistory();
    return () => {
      void engine.destroy();
    };
    // engine is stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (
    pattern: ReadonlyArray<Vibration>,
    source: GeneratorSource,
    label?: string,
  ) => {
    const draft = makeSpecimen(pattern, source, label);
    const optimistic: StoredSpecimen = {
      ...draft,
      firstSeenAt: Date.now(),
      lastPlayedAt: Date.now(),
      plays: 1,
      favorite: false,
    };
    setCurrent(optimistic);

    if (!indexedDbAvailable()) return;
    try {
      const saved = await upsertSpecimen(draft);
      setCurrent(saved);
      await refreshHistory();
    } catch {
      setStorageState('unavailable');
    }
  };

  const play = (
    pattern: ReadonlyArray<Vibration>,
    source: GeneratorSource,
    label?: string,
  ) => {
    // Trigger first so the haptic call stays as close to the trusted interaction as possible.
    void engine.trigger(pattern);
    void persist(pattern, source, label);
  };

  const jumpUniform = () => {
    const pattern = uniformRandomPattern(pulseCount, uniformMode);
    play(pattern, 'uniform', `Uniform ${pulseCount}-pulse`);
  };

  const generateTactile = () => {
    const pattern = tactileRandomPattern(pulseCount);
    play(pattern, 'tactile', 'Tactile random');
  };

  const mutateCurrent = () => {
    const pattern = mutatePattern(current?.pattern ?? uniformRandomPattern(pulseCount));
    play(pattern, 'mutation', 'One-coordinate mutation');
  };

  const collide = () => {
    const a = tactileRandomPattern(Math.max(1, Math.min(3, pulseCount)));
    const b = tactileRandomPattern(Math.max(1, Math.min(3, pulseCount + 1)));
    // Two synchronous submissions expose the v2 conductor/polyphony path.
    void engine.trigger(a);
    void engine.trigger(b);
    void persist(a, 'collision', 'Collision A');
    void persist(b, 'collision', 'Collision B');
  };

  const discoveredBuckets = useMemo(
    () => new Set(history.map((specimen) => specimen.analysis.bucketId)),
    [history],
  );

  const latestByBucket = useMemo(() => {
    const map = new Map<string, StoredSpecimen>();
    for (const specimen of history) {
      if (!map.has(specimen.analysis.bucketId)) map.set(specimen.analysis.bucketId, specimen);
    }
    return map;
  }, [history]);

  const totalPlays = useMemo(
    () => history.reduce((sum, specimen) => sum + specimen.plays, 0),
    [history],
  );
  const favorites = useMemo(() => history.filter((specimen) => specimen.favorite), [history]);
  const visibleHistory = showFavorites ? favorites : history.slice(0, 80);
  const coverage = (discoveredBuckets.size / MAP_CELLS) * 100;

  const rawSpace = rawPatternSpace(pulseCount);
  const pwmSpace = pwmPatternSpace(pulseCount);
  const rawTotalOneToSix = cumulativePatternSpace(MAX_EXPLORER_PULSES, RAW_PULSE_STATES);
  const pwmTotalOneToSix = cumulativePatternSpace(MAX_EXPLORER_PULSES, PWM_PULSE_STATES);

  const frameMs = refreshHz ? 1000 / refreshHz : null;
  const cadenceBands = frameMs
    ? Math.max(1, Math.ceil(200 / frameMs) - Math.ceil(16 / frameMs) + 1)
    : null;
  const backend = typeof navigator.vibrate === 'function' ? 'Vibration API' : 'WebKit switch synthesis';

  const handleFavorite = async (specimen: StoredSpecimen) => {
    if (!indexedDbAvailable()) return;
    await setFavorite(specimen.id, !specimen.favorite);
    await refreshHistory();
  };

  const resetAtlas = async () => {
    if (!window.confirm('Erase the local haptic atlas from IndexedDB?')) return;
    await clearSpecimens();
    setCurrent(null);
    await refreshHistory();
  };

  const exportAtlas = () => {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        lattice: {
          timeQuantumMs: 10,
          durationMs: [10, 1000],
          delayMs: [0, 1000],
          rawIntensityStep: 0.01,
          pwmAlignedIntensityStep: 0.05,
        },
        specimens: history,
      },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `haptic-atlas-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="appShell">
      <div className="ambient ambientA" />
      <div className="ambient ambientB" />

      <header className="topbar">
        <div className="brandBlock">
          <div className="brandMark"><span /><span /><span /></div>
          <div>
            <div className="eyebrow">WEBHAPTICS V2 LAB</div>
            <div className="brandName">Haptic State Space</div>
          </div>
        </div>
        <div className="runtimePills">
          <span className="runtimePill"><i className="statusDot" />{backend}</span>
          <span className="runtimePill">{refreshHz ? `${refreshHz} Hz display` : 'measuring display'}</span>
          <span className={`runtimePill ${storageState === 'ready' ? 'positive' : ''}`}>
            {storageState === 'ready' ? 'IndexedDB persistent' : storageState === 'loading' ? 'opening atlas' : 'memory only'}
          </span>
        </div>
      </header>

      <section className="hero">
        <div className="heroCopy">
          <div className="kicker">TOUCH THE COMBINATORIAL VOID</div>
          <h1>Explore a haptic universe too large to enumerate.</h1>
          <p>
            Every pulse is a coordinate. Duration, silence, intensity, sequence, overlap. Jump uniformly through the lattice, mutate one axis at a time, collide patterns through the v2 conductor, and slowly paint your own persistent map.
          </p>
        </div>
        <div className="heroNumberCard">
          <span className="smallLabel">RAW 1 TO 6 PULSE DESCRIPTORS</span>
          <strong>{formatScientific(rawTotalOneToSix, 7)}</strong>
          <span>{formatBigInt(rawTotalOneToSix)} states</span>
        </div>
      </section>

      <section className="mathRibbon">
        <div>
          <span>time lattice</span>
          <strong>10 ms</strong>
          <small>duration 10...1000, delay 0...1000</small>
        </div>
        <div>
          <span>raw intensity</span>
          <strong>101</strong>
          <small>0.00...1.00 in 1% steps</small>
        </div>
        <div>
          <span>raw pulse tuples</span>
          <strong>{formatBigInt(RAW_PULSE_STATES)}</strong>
          <small>100 × 101 × 101</small>
        </div>
        <div>
          <span>PWM-aligned tuples</span>
          <strong>{formatBigInt(PWM_PULSE_STATES)}</strong>
          <small>5% intensity, aligned to 20 ms carrier</small>
        </div>
      </section>

      <section className="workspaceGrid">
        <article className="panel specimenPanel">
          <div className="panelHeader">
            <div>
              <span className="panelIndex">01</span>
              <h2>Specimen chamber</h2>
            </div>
            <button className="ghostButton" onClick={() => engine.cancel()}>stop</button>
          </div>

          {current ? (
            <>
              <div className="specimenTitleRow">
                <div>
                  <span className="sourceTag">{current.source}</span>
                  <h3>{current.label}</h3>
                </div>
                <button
                  className={`starButton ${current.favorite ? 'active' : ''}`}
                  onClick={() => void handleFavorite(current)}
                  aria-label="Favorite specimen"
                >
                  {current.favorite ? '★' : '☆'}
                </button>
              </div>
              <MiniPattern pattern={current.pattern} />
              <div className="metricGrid">
                <Metric label="energy" value={`${Math.round(current.analysis.energy * 100)}%`} />
                <Metric label="complexity" value={`${Math.round(current.analysis.complexity * 100)}%`} />
                <Metric label="duration" value={`${Math.round(current.analysis.totalDuration)} ms`} />
                <Metric label="pulses" value={String(current.analysis.pulseCount)} />
              </div>
              <div className="addressBlock">
                <AddressLine
                  label="raw address"
                  address={current.rawAddress}
                  space={current.rawSpace}
                />
                <AddressLine
                  label="PWM projection"
                  address={current.pwmAddress}
                  space={current.pwmSpace}
                />
              </div>
              <HapticAction
                className="primaryAction"
                onActivate={() => play(current.pattern, 'history', current.label)}
              >
                <span>Replay specimen</span>
                <kbd>↵</kbd>
              </HapticAction>
            </>
          ) : (
            <div className="emptySpecimen">
              <div className="orb" />
              <h3>No specimen yet</h3>
              <p>Jump into the lattice or tap a known anchor.</p>
            </div>
          )}
        </article>

        <article className="panel atlasPanel">
          <div className="panelHeader">
            <div>
              <span className="panelIndex">02</span>
              <h2>Discovery atlas</h2>
            </div>
            <span className="coverageValue">{coverage.toFixed(1)}%</span>
          </div>
          <div className="axisLabel yAxis">complexity ↑</div>
          <div className="atlasGrid">
            {Array.from({ length: MAP_CELLS }, (_, renderIndex) => {
              const x = renderIndex % MAP_COLUMNS;
              const renderedRow = Math.floor(renderIndex / MAP_COLUMNS);
              const y = MAP_ROWS - 1 - renderedRow;
              const id = `${x}:${y}`;
              const specimen = latestByBucket.get(id);
              const active = current?.analysis.bucketId === id;
              return (
                <button
                  key={id}
                  className={`atlasCell ${specimen ? 'discovered' : ''} ${active ? 'current' : ''}`}
                  disabled={!specimen}
                  title={specimen ? `${specimen.label} · ${specimen.plays} plays` : 'unexplored region'}
                  onClick={() => specimen && play(specimen.pattern, 'history', specimen.label)}
                >
                  {specimen && <span />}
                </button>
              );
            })}
          </div>
          <div className="axisLabel xAxis">low energy <span /> high energy →</div>
          <div className="atlasStats">
            <div><strong>{discoveredBuckets.size}</strong><span>regions found</span></div>
            <div><strong>{history.length}</strong><span>unique specimens</span></div>
            <div><strong>{totalPlays}</strong><span>total plays</span></div>
            <div><strong>{favorites.length}</strong><span>favorites</span></div>
          </div>
        </article>
      </section>

      <section className="panel generatorPanel">
        <div className="panelHeader wideHeader">
          <div>
            <span className="panelIndex">03</span>
            <h2>State-space drives</h2>
          </div>
          <div className="pulseSelector" aria-label="Pulse count">
            {Array.from({ length: MAX_EXPLORER_PULSES }, (_, index) => index + 1).map((count) => (
              <button
                key={count}
                className={pulseCount === count ? 'active' : ''}
                onClick={() => setPulseCount(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <div className="generatorGrid">
          <div className="generatorCard trueRandomCard">
            <div className="generatorTopline">
              <span className="generatorGlyph">Ω</span>
              <span className="truthBadge">CRYPTO UNIFORM</span>
            </div>
            <h3>Uniform state jump</h3>
            <p>
              Every coordinate is sampled with <code>crypto.getRandomValues()</code> and rejection sampling. No <code>Math.random()</code>. For a fixed pulse count, every descriptor has equal probability.
            </p>
            <div className="modeToggle">
              <button className={uniformMode === 'raw' ? 'active' : ''} onClick={() => setUniformMode('raw')}>1% raw</button>
              <button className={uniformMode === 'pwm' ? 'active' : ''} onClick={() => setUniformMode('pwm')}>5% PWM</button>
            </div>
            <div className="spaceReadout">
              <span>{pulseCount}-pulse space</span>
              <strong>{formatScientific(uniformMode === 'raw' ? rawSpace : pwmSpace)}</strong>
              <small title={formatBigInt(uniformMode === 'raw' ? rawSpace : pwmSpace)}>
                {formatBigInt(uniformMode === 'raw' ? rawSpace : pwmSpace)} exact states
              </small>
            </div>
            <HapticAction className="primaryAction electric" onActivate={jumpUniform}>
              <span>Jump somewhere impossible</span><span>↗</span>
            </HapticAction>
          </div>

          <GeneratorCard
            glyph="✦"
            title="Tactile random"
            note="Cryptographic entropy with a human-friendly bias toward shorter pulses, shorter gaps, and non-zero intensity. Fun, but intentionally not uniform."
            action="Generate tactile"
            onActivate={generateTactile}
          />
          <GeneratorCard
            glyph="μ"
            title="One-axis mutation"
            note="Project the current specimen onto the raw lattice, then replace exactly one duration, delay, or intensity coordinate. Local search instead of teleportation."
            action="Mutate current"
            onActivate={mutateCurrent}
          />
          <GeneratorCard
            glyph="⊕"
            title="Conductor collision"
            note="Submit two independently generated patterns in the same interaction. This deliberately exercises v2 track merging and multi-voice behavior."
            action="Collide two patterns"
            onActivate={collide}
          />
        </div>
      </section>

      <section className="panel zooPanel">
        <div className="panelHeader wideHeader">
          <div>
            <span className="panelIndex">04</span>
            <h2>Pulse zoo</h2>
          </div>
          <span className="mutedCopy">hand-built anchors across the map</span>
        </div>
        <div className="zooGrid">
          {EXPERIMENTS.map((experiment) => (
            <HapticAction
              key={experiment.name}
              className="zooCard"
              onActivate={() => play(experiment.pattern, 'preset', experiment.name)}
            >
              <div className="zooCardTop"><strong>{experiment.name}</strong><span>{experiment.pattern.length}p</span></div>
              <MiniPattern pattern={experiment.pattern} />
              <small>{experiment.note}</small>
            </HapticAction>
          ))}
        </div>
        <div className="presetStrip">
          {presets.map(([name, preset]) => (
            <HapticAction
              key={name}
              className="presetChip"
              onActivate={() => play(preset.pattern, 'preset', name)}
              title={preset.description}
            >
              {name}
            </HapticAction>
          ))}
        </div>
      </section>

      <section className="panel historyPanel">
        <div className="panelHeader wideHeader">
          <div>
            <span className="panelIndex">05</span>
            <h2>Persistent field notes</h2>
          </div>
          <div className="historyActions">
            <button className={showFavorites ? 'active ghostButton' : 'ghostButton'} onClick={() => setShowFavorites((value) => !value)}>
              {showFavorites ? 'show all' : 'favorites'}
            </button>
            <button className="ghostButton" onClick={exportAtlas} disabled={!history.length}>export</button>
            <button className="ghostButton danger" onClick={() => void resetAtlas()} disabled={!history.length}>reset</button>
          </div>
        </div>

        {visibleHistory.length ? (
          <div className="historyList">
            {visibleHistory.map((specimen) => (
              <div className="historyRow" key={specimen.id}>
                <HapticAction
                  className="historyReplay"
                  onActivate={() => play(specimen.pattern, 'history', specimen.label)}
                >
                  <div className="historyIdentity">
                    <span className="sourceTag">{specimen.source}</span>
                    <strong>{specimen.label}</strong>
                  </div>
                  <MiniPattern pattern={specimen.pattern} />
                  <div className="historyMeta">
                    <span>{specimen.analysis.pulseCount}p</span>
                    <span>{Math.round(specimen.analysis.totalDuration)} ms</span>
                    <span>{specimen.plays}×</span>
                  </div>
                </HapticAction>
                <button
                  className={`starButton ${specimen.favorite ? 'active' : ''}`}
                  onClick={() => void handleFavorite(specimen)}
                  aria-label="Toggle favorite"
                >
                  {specimen.favorite ? '★' : '☆'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="historyEmpty">Your atlas is empty. The first touch creates the first record.</div>
        )}
      </section>

      <section className="theorySection">
        <div className="theoryIntro">
          <span className="panelIndex">06</span>
          <h2>What does “all haptics” actually mean?</h2>
          <p>
            Without quantization, the abstract parameter space is not a useful finite number. Intensity is continuous in the model, delays are not globally capped by the engine, and arbitrary sequence length makes the language open-ended. This explorer defines a finite lattice on purpose.
          </p>
        </div>
        <div className="theoryGrid">
          <div className="theoryCard">
            <span>RAW EXPLORER LATTICE</span>
            <h3>1,020,100 states per pulse</h3>
            <code>100 durations × 101 delays × 101 intensities</code>
            <p>10 ms time quanta, 1% intensity. Exact descriptor count under these chosen bounds.</p>
          </div>
          <div className="theoryCard">
            <span>PWM-ALIGNED PROJECTION</span>
            <h3>212,100 states per pulse</h3>
            <code>100 durations × 101 delays × 21 intensities</code>
            <p>5% intensity increments align a complete 20 ms PWM carrier cycle to 1 ms duty steps. This is a useful canonical projection, not a claim of perceptual uniqueness.</p>
          </div>
          <div className="theoryCard">
            <span>DISPLAY-LOCKED SWITCH PATH</span>
            <h3>{cadenceBands ? `~${cadenceBands} cadence bands` : 'device dependent'}</h3>
            <code>{refreshHz ? `${refreshHz} Hz measured · ${frameMs?.toFixed(2)} ms/frame` : 'measuring requestAnimationFrame cadence'}</code>
            <p>The iOS switch synthesizer can only emit on animation frames. Different refresh rates project many requested intensity values onto the same realized pulse cadence.</p>
          </div>
        </div>

        <div className="countTableWrap">
          <table className="countTable">
            <thead>
              <tr><th>pulses</th><th>raw 1% descriptors</th><th>PWM-aligned 5%</th></tr>
            </thead>
            <tbody>
              {Array.from({ length: MAX_EXPLORER_PULSES }, (_, index) => index + 1).map((count) => {
                const raw = rawPatternSpace(count);
                const pwm = pwmPatternSpace(count);
                return (
                  <tr key={count}>
                    <td>{count}</td>
                    <td title={formatBigInt(raw)}>{formatBigInt(raw)}</td>
                    <td title={formatBigInt(pwm)}>{formatBigInt(pwm)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grandTotals">
          <div><span>raw 1...6 total</span><strong>{formatBigInt(rawTotalOneToSix)}</strong></div>
          <div><span>PWM projection 1...6 total</span><strong>{formatBigInt(pwmTotalOneToSix)}</strong></div>
        </div>
      </section>

      <footer>
        <span>WebHaptics v2 state-space laboratory</span>
        <a href="https://github.com/thelabcorner/webhaptics-v2">source</a>
      </footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function AddressLine({ label, address, space }: { label: string; address: string; space: string }) {
  return (
    <div className="addressLine">
      <span>{label}</span>
      <code title={`#${BigInt(address).toLocaleString()} of ${BigInt(space).toLocaleString()}`}>
        #{formatScientific(BigInt(address), 7)} / {formatScientific(BigInt(space), 7)}
      </code>
    </div>
  );
}

function GeneratorCard({
  glyph,
  title,
  note,
  action,
  onActivate,
}: {
  glyph: string;
  title: string;
  note: string;
  action: string;
  onActivate: () => void;
}) {
  return (
    <div className="generatorCard">
      <span className="generatorGlyph">{glyph}</span>
      <h3>{title}</h3>
      <p>{note}</p>
      <HapticAction className="secondaryAction" onActivate={onActivate}>
        <span>{action}</span><span>→</span>
      </HapticAction>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
