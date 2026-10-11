import { useStore } from '../store';
import { Modal } from './common';

export function ScopeDialog() {
  const ask = useStore((s) => s.scopeAsk);
  if (!ask) return null;
  return (
    <Modal title={ask.title} onClose={() => ask.resolve(null)}>
      <div className="scope-buttons">
        <button type="button" className="btn" onClick={() => ask.resolve('this')}>Только эту</button>
        <button type="button" className="btn primary" onClick={() => ask.resolve('following')}>Эту и следующие</button>
      </div>
    </Modal>
  );
}
