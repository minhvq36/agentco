import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

const root = document.getElementById('root');
// Developer-facing, not a product string: if #root is missing nothing can render
// at all, so there is no screen left to show a localised message on.
if (!root) throw new Error('#root not found');

/**
 * `#cast` opens the contact sheet — the review surface for the character
 * drawing. → `office/ContactSheet.tsx` · docs/SPEC-office-animation.md §2b④
 *
 * ⚠ THE `import()` SITS INSIDE THE DEAD BRANCH ON PURPOSE. `import.meta.env.DEV`
 * folds to `false` in a production build, so this whole block disappears and the
 * chunk is never emitted. Writing it as a `lazy()` const instead DOES still ship
 * the chunk — measured — because the import expression then lives outside the
 * branch that can be proved unreachable. A dev page shipped with the product is
 * a dev page somebody eventually finds.
 */
if (import.meta.env.DEV && window.location.hash === '#cast') {
  void import('./office/ContactSheet').then(({ default: ContactSheet }) => {
    createRoot(root).render(
      <StrictMode>
        <ContactSheet />
      </StrictMode>,
    );
  });
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
