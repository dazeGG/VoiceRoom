// A style may set CSS custom properties (a table's columns, a grid's narrowest
// card) without a type assertion.

import 'react';

declare module 'react' {
  interface CSSProperties {
    [variable: `--${string}`]: string | number | undefined;
  }
}
