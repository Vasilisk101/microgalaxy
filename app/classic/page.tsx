import type { Metadata } from 'next';
import SimulationApp from '../simulation-app';

export const metadata: Metadata = {
  title: 'MICROGALAXY — прежние миры 0.1–0.2',
  description: 'Совместимый режим для продолжения ранее сохранённых миров без изменения модели и истории.',
};

export default function ClassicObservatory() {
  return <SimulationApp />;
}
