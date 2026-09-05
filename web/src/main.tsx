import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

const root = document.getElementById('root');
// Developer-facing, not a product string: if #root is missing nothing can render
// at all, so there is no screen left to show a localised message on.
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
