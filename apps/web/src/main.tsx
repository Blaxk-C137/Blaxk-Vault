import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('BlaxkVault could not find its #root element in index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
