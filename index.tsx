import React from 'react';
import ReactDOM from 'react-dom/client';
import '@tailwindcss/browser';
import App from './App';

console.log('Index.tsx: Starting execution');
const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('Index.tsx: Root element not found!');
  throw new Error("Could not find root element to mount to");
}

console.log('Index.tsx: Creating root');
const root = ReactDOM.createRoot(rootElement);
console.log('Index.tsx: Calling root.render');
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
