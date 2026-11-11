import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Card } from './Card';

createRoot(document.getElementById('root')!).render(<Card title="App" />);
