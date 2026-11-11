import React, { createContext, useContext } from 'react';

const Greeting = createContext<string | null>(null);

export function useGreeting(): string {
  const value = useContext(Greeting);
  if (value === null) throw new Error('Card rendered outside Providers');
  return value;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return <Greeting.Provider value="Real:">{children}</Greeting.Provider>;
}
