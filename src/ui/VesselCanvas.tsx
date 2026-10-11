import { useEffect, useRef } from 'react';
import { VesselEngine, type LayerSpec, type VesselCallbacks, type VesselLabels } from '../vessel/VesselEngine';

interface Props extends VesselCallbacks {
  /** Смена дня — сосуд наливается заново. */
  date: string;
  layers: LayerSpec[];
  draft: LayerSpec[] | null;
  labels: VesselLabels;
  highlight: string | null;
}

export function VesselCanvas({ date, layers, draft, labels, highlight, ...callbacks }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<VesselEngine | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const shown = useRef<{ date: string | null; sig: string }>({ date: null, sig: '' });

  useEffect(() => {
    const engine = new VesselEngine(canvasRef.current!, {
      onHover: (...a) => cbRef.current.onHover?.(...a),
      onLayerClick: (k) => cbRef.current.onLayerClick?.(k),
      onSpillClick: () => cbRef.current.onSpillClick?.(),
    });
    engineRef.current = engine;
    shown.current = { date: null, sig: '' };
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

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const sig = JSON.stringify(layers);
    if (shown.current.date !== date) engine.setLayers(layers, 'open');
    else if (shown.current.sig !== sig) engine.setLayers(layers, 'diff');
    shown.current = { date, sig };
  }, [date, layers]);

  useEffect(() => engineRef.current?.setDraft(draft), [draft]);
  useEffect(() => engineRef.current?.setLabels(labels), [labels]);
  useEffect(() => engineRef.current?.setHighlight(highlight), [highlight]);

  return (
    <div ref={wrapRef} className="vessel-canvas">
      <canvas ref={canvasRef} />
    </div>
  );
}
