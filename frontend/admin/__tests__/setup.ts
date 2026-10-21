import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// GH #478: the RTL default waitFor budget is 1s; under CPU load a full
// fork-pool run starves react-query settle + heavy first renders past it
// (the Menubar mini-calendar family) → load-correlated flakes. 5s covers
// the suite; green paths still exit on first success. Absence-waits whose
// short window IS the assertion pass an explicit `timeout` (canon:
// vitest-playwright-patterns §2).
configure({ asyncUtilTimeout: 5000 });
