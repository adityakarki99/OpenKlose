import React from 'react';
import { useGreeting } from './Providers';

// The real component: it reads context, so it only renders inside the app's providers.
export function Card({ title = 'Untitled', count }: { title?: string; count?: number }) {
  const greeting = useGreeting();
  return (
    <section className="card" data-real-card>
      <h2>{greeting} {title}</h2>
      {count !== undefined && <p data-count>{count}</p>}
    </section>
  );
}

export default function Screen() {
  return <p data-real-screen>Default export</p>;
}
