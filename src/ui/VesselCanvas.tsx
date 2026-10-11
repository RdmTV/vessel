import { useEffect, useRef } from 'react';
import {
  DAY_SCALE, VesselEngine, type LayerSpec, type VesselCallbacks, type VesselLabels, type VesselScale,
} from '../vessel/VesselEngine';

interface Props extends VesselCallbacks {
  /** Смена сцены (другой день или неделя) — сосуд насыпается заново. */
  sceneKey: string;
  layers: LayerSpec[];
  draft?: LayerSpec[] | null;
  labels: VesselLabels;
  highlight: string | null;
  scale?: VesselScale;
}

export function VesselCanvas({ sceneKey, layers, draft = null, labels, highlight, scale = DAY_SCALE, ...callbacks }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<VesselEngine | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const shown = useRef<{ scene: string | null; sig: string }>({ scene: null, sig: '' });

  useEffect(() => {
    const engine = new VesselEngine(canvasRef.current!, {
      onHover: (...a) => cbRef.current.onHover?.(...a),
      onLayerClick: (k) => cbRef.current.onLayerClick?.(k),
      onSpillClick: () => cbRef.current.onSpillClick?.(),
    });
    engineRef.current = engine;
    shown.current = { scene: null, sig: '' };
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      engine.resize(width, height);
    });
    ro.observe(wrapRef.current!);
    return () => {
      ro.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Шкала задаётся до слоёв: от неё зависит отрисовка.
  useEffect(() => engineRef.current?.setScale(scale), [scale]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const sig = JSON.stringify(layers);
    if (shown.current.scene !== sceneKey) engine.setLayers(layers, 'open');
    else if (shown.current.sig !== sig) engine.setLayers(layers, 'diff');
    shown.current = { scene: sceneKey, sig };
  }, [sceneKey, layers]);

  useEffect(() => engineRef.current?.setDraft(draft), [draft]);
  useEffect(() => engineRef.current?.setLabels(labels), [labels]);
  useEffect(() => engineRef.current?.setHighlight(highlight), [highlight]);

  return (
    <div ref={wrapRef} className="vessel-canvas">
      <canvas ref={canvasRef} />
    </div>
  );
}
