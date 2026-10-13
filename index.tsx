import React from 'react';
import ReactDOM from 'react-dom/client';
import './app.css';
import App from './App';
import { BASE_URL, STATIC } from './lib/mode';

// The hosted canvas keeps working offline once it has loaded (public/sw.js).
// Only over https, which GitHub Pages is; a local preview never installs it.
if (STATIC && 'serviceWorker' in navigator && window.location.protocol === 'https:') {
  navigator.serviceWorker.register(`${BASE_URL}sw.js`).catch(() => {});
}

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
